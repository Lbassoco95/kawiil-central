-- Rollback: supabase/migrations/20260918120000_async_worker_jobs.sql
DROP FUNCTION IF EXISTS public.claim_async_worker_jobs(text, integer, integer);
DROP TABLE IF EXISTS public.async_worker_jobs;
