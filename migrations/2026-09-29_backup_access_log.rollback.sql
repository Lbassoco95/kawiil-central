-- 2026-09-29 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929100100_backup_access_log.sql.
-- Destructivo: se pierde la bitácora de llamadas a backup-data (expórtela antes:
--   SELECT * FROM public.backup_access_log ORDER BY occurred_at;).
DROP TABLE IF EXISTS public.backup_access_log;
DROP FUNCTION IF EXISTS public.backup_access_log_immutable();
