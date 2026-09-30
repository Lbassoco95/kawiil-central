-- Rollback de 20260918140000_job_queue.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mtg-job-queue-dispatch';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.invoke_job_queue_cron();
DROP FUNCTION IF EXISTS public.fail_job(uuid, text);
DROP FUNCTION IF EXISTS public.complete_job(uuid, jsonb);
DROP FUNCTION IF EXISTS public.claim_jobs(text[], integer, text, integer);
DROP TABLE IF EXISTS public.job_queue;
