-- Rollback 20260918140200
ALTER TABLE public.mtg_series DROP COLUMN IF EXISTS slack_channel_id;
DROP INDEX IF EXISTS public.idx_documents_client_group;
ALTER TABLE public.documents DROP COLUMN IF EXISTS client_group_id;
