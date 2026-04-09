-- Cola de envíos programados de Outlook (Graph send-draft desde worker con tokens en microsoft_tokens).

CREATE TYPE public.scheduled_mail_job_status AS ENUM (
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled'
);

CREATE TYPE public.scheduled_mail_job_kind AS ENUM ('send_draft');

CREATE TABLE public.scheduled_mail_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status public.scheduled_mail_job_status NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL,
  kind public.scheduled_mail_job_kind NOT NULL DEFAULT 'send_draft',
  draft_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scheduled_mail_jobs_pending_due
  ON public.scheduled_mail_jobs (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX scheduled_mail_jobs_user_status
  ON public.scheduled_mail_jobs (user_id, status, scheduled_at DESC);

ALTER TABLE public.scheduled_mail_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own scheduled mail jobs"
  ON public.scheduled_mail_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own scheduled mail jobs"
  ON public.scheduled_mail_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own scheduled mail jobs"
  ON public.scheduled_mail_jobs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
