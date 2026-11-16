-- Marketing: seguimientos también para el CMO. PENDIENTE: NO aplicada en producción; se aplica solo con la confirmación de Dirección,
-- y el archivo pasa a supabase/migrations/ con la versión real del registro cuando ya esté aplicada.
-- Requiere antes 20261106003827_marketing_analista_seguimientos.sql y 20261113015847_marketing_cmo_registro.sql (ya aplicadas).
--
-- Un seguimiento es una pregunta que un agente de Marketing vuelve a responder solo (una vez, a diario o cada semana). Hasta hoy siempre lo respondía el Analista.
-- 1) mk_seguimiento.agente: marketing_analista (por defecto, así los seguimientos existentes siguen igual) o marketing_cmo.
-- 2) mk_seguimiento_crear recibe p_agente (por defecto marketing_analista, compatible con el código actual) y el tope de 5 se cuenta por usuario Y por agente.
-- 3) mk_seguimiento_reclamar devuelve también el agente. mk_seguimiento_cambiar no cambia.
-- Sigue siendo solo lectura. Todas las funciones, solo service_role. Reversa: tools/marketing/rollback_cmo_seguimientos.sql
-- Prueba: tools/marketing/prueba_seguimientos_pglite.mjs

ALTER TABLE public.mk_seguimiento
  ADD COLUMN IF NOT EXISTS agente text NOT NULL DEFAULT 'marketing_analista'
  CHECK (agente IN ('marketing_analista', 'marketing_cmo'));
CREATE INDEX IF NOT EXISTS mk_seguimiento_usuario_agente ON public.mk_seguimiento (user_id, agente, estado);

-- Se reemplazan (no se sobrecargan) para que una llamada sin p_agente no sea ambigua.
DROP FUNCTION IF EXISTS public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.mk_seguimiento_reclamar(integer);

CREATE FUNCTION public.mk_seguimiento_crear(p_org uuid, p_user uuid, p_pregunta text, p_frecuencia text, p_primera timestamptz DEFAULT now(), p_agente text DEFAULT 'marketing_analista')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_frecuencia NOT IN ('una_vez', 'diaria', 'semanal') THEN RAISE EXCEPTION 'mk_seguimiento_crear: frecuencia no válida: %', p_frecuencia; END IF;
  IF p_agente NOT IN ('marketing_analista', 'marketing_cmo') THEN RAISE EXCEPTION 'mk_seguimiento_crear: agente no válido: %', p_agente; END IF;
  IF char_length(coalesce(trim(p_pregunta), '')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'mk_seguimiento_crear: la pregunta debe tener de 3 a 500 caracteres'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mk_seguimiento:' || p_user::text));
  IF (SELECT count(*) FROM public.mk_seguimiento WHERE user_id = p_user AND agente = p_agente AND estado IN ('activo', 'pausado')) >= 5 THEN
    RAISE EXCEPTION 'mk_seguimiento_crear: tope de 5 seguimientos por usuario y agente';
  END IF;
  INSERT INTO public.mk_seguimiento (organization_id, user_id, agente, pregunta, frecuencia, proxima_at)
  VALUES (p_org, p_user, p_agente, trim(p_pregunta), p_frecuencia, GREATEST(coalesce(p_primera, now()), now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.mk_seguimiento_reclamar(p_limite integer DEFAULT 5)
RETURNS TABLE (id uuid, organization_id uuid, user_id uuid, pregunta text, agente text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
    RETURNING s.id, s.organization_id, s.user_id, s.pregunta, s.agente
  )
  SELECT m.id, m.organization_id, m.user_id, m.pregunta, m.agente FROM movidos m;
END $$;

REVOKE ALL ON FUNCTION public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_seguimiento_reclamar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_reclamar(integer) TO service_role;
