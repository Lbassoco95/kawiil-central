-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929120200_portal_account_deletion.sql.
-- Destructivo para los REGISTROS de solicitudes y retenciones (las fechas de purga
-- se pierden: anótelas antes si hay retenciones vigentes:
--   SELECT client_id, subject, retain_until FROM public.portal_retention_holds WHERE purged_at IS NULL;).
-- No revierte seudonimizaciones ya hechas (no se puede ni se debe).
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-retention-purge';
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;
DROP FUNCTION IF EXISTS public.portal_purge_expired_retention(timestamptz);
DROP FUNCTION IF EXISTS public.portal_finish_account_deletion(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.portal_execute_account_deletion(uuid);
DROP FUNCTION IF EXISTS public.portal_pseudonymize_subject(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.portal_account_deletion_plan(uuid);
DROP FUNCTION IF EXISTS public.portal_deletion_scope(uuid);
DROP TABLE IF EXISTS public.portal_storage_purge_queue;
DROP TABLE IF EXISTS public.portal_retention_holds;
DROP TABLE IF EXISTS public.portal_deletion_requests;
-- Inmutabilidad total de nuevo (versión de 20260929110000).
CREATE OR REPLACE FUNCTION public.portal_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'portal_audit_log es inmutable (% rechazado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP FUNCTION IF EXISTS public.portal_pseudonym_text(text);
DROP FUNCTION IF EXISTS public.portal_pseudonym_uuid(uuid);
DROP TABLE IF EXISTS public.portal_pseudonym_salt;
DROP FUNCTION IF EXISTS public.portal_retention_years();
DROP TABLE IF EXISTS public.portal_retention_policy;
