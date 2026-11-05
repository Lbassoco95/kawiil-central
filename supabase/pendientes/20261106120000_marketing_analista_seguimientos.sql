-- Marketing: seguimientos del Analista (preguntas puntuales o periódicas). NO SE APLICA sin confirmación de Dirección.
-- Requiere antes 20261105194055_marketing_analista_registro.sql (ya aplicada).
--
-- Un seguimiento es una pregunta que el Analista vuelve a responder solo: una vez, a diario o cada semana. Sigue siendo solo lectura.
-- 1) Tabla mk_seguimiento. La leen quienes pueden ver Marketing en su organización; solo la escribe service_role (por las funciones de abajo).
-- 2) mk_consulta.seguimiento_id: enlaza cada respuesta con el seguimiento que la originó (nulo si fue una pregunta directa).
-- 3) mk_seguimiento_crear / mk_seguimiento_cambiar / mk_seguimiento_reclamar (solo service_role). Tope: 5 seguimientos activos por usuario.
--    «Reclamar» toma los vencidos y adelanta su próxima fecha antes de correrlos (FOR UPDATE SKIP LOCKED): una corrida repetida no duplica respuestas.
-- Reversa: tools/marketing/rollback_analista_seguimientos.sql

CREATE TABLE IF NOT EXISTS public.mk_seguimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  pregunta text NOT NULL CHECK (char_length(pregunta) BETWEEN 3 AND 500),
  frecuencia text NOT NULL CHECK (frecuencia IN ('una_vez', 'diaria', 'semanal')),
  proxima_at timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado', 'terminado')),
  corridas integer NOT NULL DEFAULT 0,
  ultima_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mk_seguimiento_vencidos ON public.mk_seguimiento (proxima_at) WHERE estado = 'activo';
CREATE INDEX IF NOT EXISTS mk_seguimiento_usuario ON public.mk_seguimiento (user_id, estado);

ALTER TABLE public.mk_seguimiento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mk_seguimiento_lectura ON public.mk_seguimiento;
CREATE POLICY mk_seguimiento_lectura ON public.mk_seguimiento FOR SELECT TO authenticated
  USING (public.mk_can_view() AND organization_id = public.mk_org_id());
REVOKE ALL ON public.mk_seguimiento FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mk_seguimiento TO authenticated;
GRANT ALL ON public.mk_seguimiento TO service_role;

ALTER TABLE public.mk_consulta ADD COLUMN IF NOT EXISTS seguimiento_id uuid REFERENCES public.mk_seguimiento(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS mk_consulta_seguimiento ON public.mk_consulta (seguimiento_id) WHERE seguimiento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mk_seguimiento_crear(p_org uuid, p_user uuid, p_pregunta text, p_frecuencia text, p_primera timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_frecuencia NOT IN ('una_vez', 'diaria', 'semanal') THEN RAISE EXCEPTION 'mk_seguimiento_crear: frecuencia no válida: %', p_frecuencia; END IF;
  IF char_length(coalesce(trim(p_pregunta), '')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'mk_seguimiento_crear: la pregunta debe tener de 3 a 500 caracteres'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mk_seguimiento:' || p_user::text));
  IF (SELECT count(*) FROM public.mk_seguimiento WHERE user_id = p_user AND estado IN ('activo', 'pausado')) >= 5 THEN
    RAISE EXCEPTION 'mk_seguimiento_crear: tope de 5 seguimientos por usuario';
  END IF;
  INSERT INTO public.mk_seguimiento (organization_id, user_id, pregunta, frecuencia, proxima_at)
  VALUES (p_org, p_user, trim(p_pregunta), p_frecuencia, GREATEST(coalesce(p_primera, now()), now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.mk_seguimiento_cambiar(p_id uuid, p_org uuid, p_user uuid, p_estado text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_estado NOT IN ('activo', 'pausado', 'terminado') THEN RAISE EXCEPTION 'mk_seguimiento_cambiar: estado no válido: %', p_estado; END IF;
  UPDATE public.mk_seguimiento SET estado = p_estado
  WHERE id = p_id AND organization_id = p_org AND user_id = p_user AND estado <> 'terminado';
  IF NOT FOUND THEN RAISE EXCEPTION 'mk_seguimiento_cambiar: seguimiento no encontrado o ya terminado'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mk_seguimiento_reclamar(p_limite integer DEFAULT 5)
RETURNS TABLE (id uuid, organization_id uuid, user_id uuid, pregunta text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH tomados AS (
    SELECT s.id FROM public.mk_seguimiento s
    WHERE s.estado = 'activo' AND s.proxima_at <= now()
    ORDER BY s.proxima_at LIMIT GREATEST(1, LEAST(coalesce(p_limite, 5), 10))
    FOR UPDATE SKIP LOCKED
  ), movidos AS (
    UPDATE public.mk_seguimiento s SET
      corridas = s.corridas + 1, ultima_at = now(),
      estado = CASE WHEN s.frecuencia = 'una_vez' THEN 'terminado' ELSE s.estado END,
      proxima_at = CASE s.frecuencia WHEN 'diaria' THEN now() + interval '1 day' WHEN 'semanal' THEN now() + interval '7 days' ELSE s.proxima_at END
    FROM tomados t WHERE s.id = t.id
    RETURNING s.id, s.organization_id, s.user_id, s.pregunta
  )
  SELECT m.id, m.organization_id, m.user_id, m.pregunta FROM movidos m;
END $$;

REVOKE ALL ON FUNCTION public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_seguimiento_cambiar(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_seguimiento_reclamar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_cambiar(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_reclamar(integer) TO service_role;
