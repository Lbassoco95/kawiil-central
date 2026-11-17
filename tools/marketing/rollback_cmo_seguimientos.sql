-- Reversa de 20261116165640_marketing_cmo_seguimientos.sql. Borra los seguimientos del CMO (las respuestas pasadas en mk_consulta se conservan)
-- y deja las funciones y la tabla como las dejó 20261106003827_marketing_analista_seguimientos.sql.
DELETE FROM public.mk_seguimiento WHERE agente <> 'marketing_analista';
DROP FUNCTION IF EXISTS public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.mk_seguimiento_reclamar(integer);
DROP INDEX IF EXISTS public.mk_seguimiento_usuario_agente;
ALTER TABLE public.mk_seguimiento DROP COLUMN IF EXISTS agente;

CREATE FUNCTION public.mk_seguimiento_crear(p_org uuid, p_user uuid, p_pregunta text, p_frecuencia text, p_primera timestamptz DEFAULT now())
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

CREATE FUNCTION public.mk_seguimiento_reclamar(p_limite integer DEFAULT 5)
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
REVOKE ALL ON FUNCTION public.mk_seguimiento_reclamar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_crear(uuid, uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_seguimiento_reclamar(integer) TO service_role;
