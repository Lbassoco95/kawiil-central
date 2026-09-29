-- =================================================================
-- backup-data · A6: bitácora de cada llamada, aceptada o rechazada.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-29
-- Rollback (a mano): migrations/2026-09-29_backup_access_log.rollback.sql
--
-- Nunca guarda el contenido del volcado: solo cuándo, resultado, motivo, vía,
-- quién (si fue un G4), IP, navegador, si pidió datos, cuántas tablas/filas y el
-- archivo. La escribe la función con service_role; solo la leen los G4; nadie la
-- modifica ni la borra.
-- =================================================================
CREATE TABLE IF NOT EXISTS public.backup_access_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('aceptada', 'rechazada', 'error')),
  reason text NOT NULL,
  via text CHECK (via IS NULL OR via IN ('cron', 'g4')),
  user_id uuid,
  ip text,
  user_agent text,
  include_data boolean NOT NULL DEFAULT false,
  tables int,
  rows bigint,
  file text
);
CREATE INDEX IF NOT EXISTS idx_backup_access_log_occurred ON public.backup_access_log (occurred_at DESC);
ALTER TABLE public.backup_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.backup_access_log TO authenticated;
GRANT SELECT, INSERT ON public.backup_access_log TO service_role;
GRANT USAGE ON SEQUENCE public.backup_access_log_id_seq TO service_role;
DROP POLICY IF EXISTS backup_access_log_g4_read ON public.backup_access_log;
CREATE POLICY backup_access_log_g4_read ON public.backup_access_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'transformador'::app_role));

CREATE OR REPLACE FUNCTION public.backup_access_log_immutable()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'backup_access_log es inmutable (% rechazado)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS trg_backup_access_log_immutable ON public.backup_access_log;
CREATE TRIGGER trg_backup_access_log_immutable
  BEFORE UPDATE OR DELETE ON public.backup_access_log
  FOR EACH ROW EXECUTE FUNCTION public.backup_access_log_immutable();
DROP TRIGGER IF EXISTS trg_backup_access_log_no_truncate ON public.backup_access_log;
CREATE TRIGGER trg_backup_access_log_no_truncate
  BEFORE TRUNCATE ON public.backup_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.backup_access_log_immutable();
