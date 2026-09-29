-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929120600_portal_client_offboarding.sql (B4).
-- Correr ANTES de los rollbacks de 20260929120500 y 20260929120400.
-- Borra los registros de solicitudes de baja de clientes (no tienen persona):
-- anótelos antes si hace falta:
--   SELECT id, client_id, status, requested_at FROM public.portal_deletion_requests WHERE subject_pseudonym IS NULL;
-- No revierte bajas ya ejecutadas (lo destruido no vuelve).
DROP FUNCTION IF EXISTS public.portal_client_offboarding_finish(uuid, text);
DROP FUNCTION IF EXISTS public.portal_client_offboarding_pending(uuid);
DROP FUNCTION IF EXISTS public.portal_client_offboarding_execute(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.portal_client_offboarding_plan(uuid);
ALTER TABLE public.portal_accounts DROP COLUMN IF EXISTS pending_deletion_request_id;
DELETE FROM public.portal_deletion_requests WHERE subject_pseudonym IS NULL;
ALTER TABLE public.portal_deletion_requests DROP CONSTRAINT IF EXISTS portal_deletion_requests_status_check;
ALTER TABLE public.portal_deletion_requests ADD CONSTRAINT portal_deletion_requests_status_check
  CHECK (status IN ('bloqueada', 'en_proceso', 'ejecutada', 'error'));
ALTER TABLE public.portal_deletion_requests DROP COLUMN IF EXISTS client_id, DROP COLUMN IF EXISTS requested_by;
ALTER TABLE public.portal_deletion_requests ALTER COLUMN subject_pseudonym SET NOT NULL;
