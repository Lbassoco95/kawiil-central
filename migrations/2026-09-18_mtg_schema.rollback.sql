-- Rollback: supabase/migrations/20260918120100_mtg_schema.sql
ALTER TABLE public.tasks DROP COLUMN IF EXISTS mtg_meeting_id;

DROP TRIGGER IF EXISTS trg_mtg_audit_log_no_update ON public.mtg_audit_log;
DROP FUNCTION IF EXISTS public.mtg_audit_log_deny_mutation();

DROP TABLE IF EXISTS public.mtg_transcripts;
DROP TABLE IF EXISTS public.mtg_minutes;
DROP TABLE IF EXISTS public.mtg_decisions;
DROP TABLE IF EXISTS public.mtg_agreements;
DROP TABLE IF EXISTS public.mtg_topics;
DROP TABLE IF EXISTS public.mtg_meetings;
DROP TABLE IF EXISTS public.mtg_series;
DROP TABLE IF EXISTS public.mtg_graph_subscriptions;
DROP TABLE IF EXISTS public.mtg_audit_log;
