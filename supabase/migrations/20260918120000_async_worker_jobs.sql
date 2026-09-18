-- =================================================================
-- Cola genérica de trabajos para workers en kawiil-agents (VM).
-- Reutilizable por Múuch' (transcripción/minuta), Ju'un (tickets), etc.
-- Toma de jobs: FOR UPDATE SKIP LOCKED + lease_until.
--
-- Rollback: migrations/2026-09-18_async_worker_jobs.rollback.sql
-- =================================================================

CREATE TABLE IF NOT EXISTS public.async_worker_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'processing', 'completed', 'failed', 'cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  leased_by text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT async_worker_jobs_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT async_worker_jobs_max_attempts_pos CHECK (max_attempts > 0)
);

COMMENT ON TABLE public.async_worker_jobs IS
  'Cola Postgres para workers (SKIP LOCKED). job_type es namespaced (p. ej. mtg.fetch_transcript, fis.process_receipt).';

CREATE INDEX IF NOT EXISTS idx_async_worker_jobs_org_status
  ON public.async_worker_jobs (organization_id, status, scheduled_for, priority DESC);

CREATE INDEX IF NOT EXISTS idx_async_worker_jobs_claim
  ON public.async_worker_jobs (scheduled_for, priority DESC)
  WHERE status IN ('pending', 'leased');

DROP TRIGGER IF EXISTS update_async_worker_jobs_updated_at ON public.async_worker_jobs;
CREATE TRIGGER update_async_worker_jobs_updated_at
  BEFORE UPDATE ON public.async_worker_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reclama hasta p_limit filas pendientes o cuyo lease expiró.
CREATE OR REPLACE FUNCTION public.claim_async_worker_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.async_worker_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 50));
  v_lease interval := make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300)));
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'claim_async_worker_jobs: p_worker_id requerido';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.async_worker_jobs j
    WHERE j.status IN ('pending', 'leased')
      AND j.scheduled_for <= now()
      AND (j.lease_until IS NULL OR j.lease_until < now())
      AND j.attempts < j.max_attempts
    ORDER BY j.priority DESC, j.scheduled_for ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.async_worker_jobs j
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

REVOKE ALL ON FUNCTION public.claim_async_worker_jobs(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_async_worker_jobs(text, integer, integer) TO service_role;

ALTER TABLE public.async_worker_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "async_worker_jobs_select_org" ON public.async_worker_jobs;
CREATE POLICY "async_worker_jobs_select_org"
  ON public.async_worker_jobs FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "async_worker_jobs_insert_org" ON public.async_worker_jobs;
CREATE POLICY "async_worker_jobs_insert_org"
  ON public.async_worker_jobs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "async_worker_jobs_update_org" ON public.async_worker_jobs;
CREATE POLICY "async_worker_jobs_update_org"
  ON public.async_worker_jobs FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "async_worker_jobs_service_role" ON public.async_worker_jobs;
CREATE POLICY "async_worker_jobs_service_role"
  ON public.async_worker_jobs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.async_worker_jobs TO authenticated;
GRANT ALL ON public.async_worker_jobs TO service_role;
