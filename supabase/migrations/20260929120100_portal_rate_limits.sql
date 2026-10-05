-- =================================================================
-- Portal del cliente — C3: límite de solicitudes públicas (registro,
-- recuperación de contraseña, reenvío de confirmación) por IP y por correo.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_rate_limits.rollback.sql
--
-- Solo guarda HUELLAS (sha256 con sal del servidor) de la IP y del correo,
-- nunca el dato en claro. Ventana fija; los límites los pasa la Edge desde
-- variables de entorno (PORTAL_RL_*). Solo service_role.
-- =================================================================
CREATE TABLE IF NOT EXISTS public.portal_rate_limits (
  bucket text NOT NULL,
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  hits int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key_hash, window_start)
);
ALTER TABLE public.portal_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_rate_limits FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_portal_rate_limits_window ON public.portal_rate_limits (window_start);

-- Suma un intento y dice si sigue dentro del límite. Limpia ventanas viejas.
CREATE OR REPLACE FUNCTION public.portal_rate_limit_hit(_bucket text, _key_hash text, _limit int, _window_seconds int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_start timestamptz; v_hits int;
BEGIN
  IF _limit < 1 OR _window_seconds < 1 OR _key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Parámetros de límite inválidos';
  END IF;
  v_start := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.portal_rate_limits AS r (bucket, key_hash, window_start, hits)
  VALUES (_bucket, _key_hash, v_start, 1)
  ON CONFLICT (bucket, key_hash, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING hits INTO v_hits;
  DELETE FROM public.portal_rate_limits WHERE window_start < now() - interval '2 days';
  RETURN jsonb_build_object('allowed', v_hits <= _limit, 'hits', v_hits, 'limit', _limit,
    'retry_after_seconds', GREATEST(0, ceil(extract(epoch FROM (v_start + make_interval(secs => _window_seconds) - now())))::int));
END;
$$;
REVOKE ALL ON FUNCTION public.portal_rate_limit_hit(text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_rate_limit_hit(text, text, int, int) TO service_role;
