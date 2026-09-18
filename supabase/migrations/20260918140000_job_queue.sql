-- =================================================================
-- Cola genérica job_queue (Múuch' B3; reutilizable por Ju'un).
-- claim con FOR UPDATE SKIP LOCKED; sólo service_role escribe jobs.
-- Rollback: migrations/2026-09-18_job_queue.rollback.sql
-- =================================================================

CREATE TABLE IF NOT EXISTS public.job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'done', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_until timestamptz,
  leased_by text,
  run_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT job_queue_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT job_queue_max_attempts_pos CHECK (max_attempts > 0)
);

COMMENT ON TABLE public.job_queue IS
  'Cola Postgres SKIP LOCKED. kind namespaced: mtg.fetch_transcript, mtg.generate_minutes, fis.*';

CREATE INDEX IF NOT EXISTS idx_job_queue_claim
  ON public.job_queue (status, run_after, created_at)
  WHERE status IN ('pending', 'leased');

CREATE INDEX IF NOT EXISTS idx_job_queue_org_kind
  ON public.job_queue (organization_id, kind, status);

DROP TRIGGER IF EXISTS update_job_queue_updated_at ON public.job_queue;
CREATE TRIGGER update_job_queue_updated_at
  BEFORE UPDATE ON public.job_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_jobs(
  p_kinds text[],
  p_limit integer DEFAULT 1,
  p_worker_id text DEFAULT 'worker',
  p_lease_seconds integer DEFAULT 600
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 50));
  v_lease interval := make_interval(secs => greatest(60, coalesce(p_lease_seconds, 600)));
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.job_queue j
    WHERE j.status IN ('pending', 'leased')
      AND j.run_after <= now()
      AND (j.lease_until IS NULL OR j.lease_until < now())
      AND j.attempts < j.max_attempts
      AND (p_kinds IS NULL OR cardinality(p_kinds) = 0 OR j.kind = ANY (p_kinds))
    ORDER BY j.run_after ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.job_queue j
  SET
    status = 'leased',
    leased_by = p_worker_id,
    lease_until = now() + v_lease,
    attempts = j.attempts + 1,
    updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_result jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_queue
  SET status = 'done',
      result = p_result,
      completed_at = now(),
      lease_until = NULL,
      updated_at = now()
  WHERE id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_job(p_job_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_max integer;
  v_backoff interval;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max
  FROM public.job_queue WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_attempts >= v_max THEN
    UPDATE public.job_queue
    SET status = 'dead',
        last_error = p_error,
        lease_until = NULL,
        updated_at = now()
    WHERE id = p_job_id;
  ELSE
    v_backoff := make_interval(mins => (CASE v_attempts WHEN 1 THEN 1 WHEN 2 THEN 5 ELSE 25 END));
    UPDATE public.job_queue
    SET status = 'pending',
        last_error = p_error,
        lease_until = NULL,
        run_after = now() + v_backoff,
        updated_at = now()
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(text[], integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_job(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text[], integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_job(uuid, text) TO service_role;

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_queue_select_org" ON public.job_queue;
CREATE POLICY "job_queue_select_org"
  ON public.job_queue FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- El front encola mtg.generate_minutes / mtg.remind para su org.
DROP POLICY IF EXISTS "job_queue_insert_org" ON public.job_queue;
CREATE POLICY "job_queue_insert_org"
  ON public.job_queue FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

-- Cancelar recordatorios (pending/leased) desde el cliente.
DROP POLICY IF EXISTS "job_queue_update_org_pending" ON public.job_queue;
CREATE POLICY "job_queue_update_org_pending"
  ON public.job_queue FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND status IN ('pending', 'leased')
  )
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "job_queue_service_all" ON public.job_queue;
CREATE POLICY "job_queue_service_all"
  ON public.job_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.job_queue TO authenticated;
GRANT ALL ON public.job_queue TO service_role;

-- Cron cada 2 min → Edge job-queue-dispatch (mismo patrón process-scheduled-mail)
CREATE OR REPLACE FUNCTION public.invoke_job_queue_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    v_secret := current_setting('app.pipeline_cron_secret', true);
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'job-queue cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/job-queue-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_job_queue_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_job_queue_cron() TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job WHERE jobname = 'mtg-job-queue-dispatch';
    PERFORM cron.schedule(
      'mtg-job-queue-dispatch',
      '*/2 * * * *',
      $$SELECT public.invoke_job_queue_cron()$$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'job_queue cron schedule skipped: %', SQLERRM;
END $$;
