-- =================================================================
-- Múuch' (mtg_*) — Bloque 1: esquema de juntas con clientes
--
-- Tenancy: organization_id NOT NULL + RLS get_user_org_id(auth.uid()).
-- Acuerdos → public.tasks (tasks.mtg_meeting_id); minuta → documents + bucket mtg.
--
-- Rollback: migrations/2026-09-18_mtg_schema.rollback.sql
-- =================================================================

-- ── Bitácora append-only ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL
    CHECK (entity_type IN (
      'series', 'meeting', 'topic', 'agreement', 'decision', 'minutes', 'transcript'
    )),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  snapshot jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_mtg_audit_log_org_time
  ON public.mtg_audit_log (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_mtg_audit_log_entity
  ON public.mtg_audit_log (entity_type, entity_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.mtg_audit_log_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'mtg_audit_log es append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_mtg_audit_log_no_update ON public.mtg_audit_log;
CREATE TRIGGER trg_mtg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.mtg_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.mtg_audit_log_deny_mutation();

-- ── Suscripciones Graph (columnas v1; Bloque 3) ────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_graph_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  subscription_id text,
  resource text,
  expiration_at timestamptz,
  client_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mtg_graph_subscriptions_org_tenant
  ON public.mtg_graph_subscriptions (organization_id, tenant_id);

DROP TRIGGER IF EXISTS update_mtg_graph_subscriptions_updated_at ON public.mtg_graph_subscriptions;
CREATE TRIGGER update_mtg_graph_subscriptions_updated_at
  BEFORE UPDATE ON public.mtg_graph_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Serie recurrente ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  anchor_type text NOT NULL CHECK (anchor_type IN ('client', 'group')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  client_group_id uuid REFERENCES public.client_groups(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  cadence text NOT NULL DEFAULT 'weekly'
    CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'adhoc')),
  default_duration_min integer NOT NULL DEFAULT 60
    CHECK (default_duration_min > 0 AND default_duration_min <= 480),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  attendees_internal uuid[] NOT NULL DEFAULT '{}'::uuid[],
  attendees_client jsonb NOT NULL DEFAULT '[]'::jsonb,
  outlook_series_id text,
  teams_join_url text,
  agenda_template jsonb NOT NULL DEFAULT '[]'::jsonb,
  organizer_tenant_id text,
  transcription_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mtg_series_anchor_check CHECK (
    (anchor_type = 'client' AND client_id IS NOT NULL AND client_group_id IS NULL)
    OR (anchor_type = 'group' AND client_group_id IS NOT NULL AND client_id IS NULL)
  ),
  CONSTRAINT mtg_series_attendees_client_array CHECK (jsonb_typeof(attendees_client) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_mtg_series_org_client
  ON public.mtg_series (organization_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mtg_series_org_group
  ON public.mtg_series (organization_id, client_group_id)
  WHERE client_group_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_mtg_series_updated_at ON public.mtg_series;
CREATE TRIGGER update_mtg_series_updated_at
  BEFORE UPDATE ON public.mtg_series
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Ocurrencia de junta ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES public.mtg_series(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'preparing', 'in_progress', 'completed', 'cancelled')),
  outlook_event_id text,
  teams_join_url text,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_series_start
  ON public.mtg_meetings (series_id, scheduled_start DESC);

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_client_start
  ON public.mtg_meetings (client_id, scheduled_start DESC);

DROP TRIGGER IF EXISTS update_mtg_meetings_updated_at ON public.mtg_meetings;
CREATE TRIGGER update_mtg_meetings_updated_at
  BEFORE UPDATE ON public.mtg_meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Temas / agenda ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text,
  source text NOT NULL DEFAULT 'template'
    CHECK (source IN (
      'template', 'carryover_agreement', 'carryover_task', 'deadline', 'team_added', 'live'
    )),
  reviewed_at timestamptz,
  dropped_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mtg_topics_meeting_sort
  ON public.mtg_topics (meeting_id, sort_order);

DROP TRIGGER IF EXISTS update_mtg_topics_updated_at ON public.mtg_topics;
CREATE TRIGGER update_mtg_topics_updated_at
  BEFORE UPDATE ON public.mtg_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Acuerdos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected', 'superseded')),
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  project_hint jsonb,
  source text NOT NULL DEFAULT 'live'
    CHECK (source IN ('live', 'ai_proposed', 'carryover')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mtg_agreements_meeting
  ON public.mtg_agreements (meeting_id);

CREATE INDEX IF NOT EXISTS idx_mtg_agreements_task
  ON public.mtg_agreements (task_id)
  WHERE task_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_mtg_agreements_updated_at ON public.mtg_agreements;
CREATE TRIGGER update_mtg_agreements_updated_at
  BEFORE UPDATE ON public.mtg_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Decisiones ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.mtg_topics(id) ON DELETE SET NULL,
  summary text NOT NULL CHECK (btrim(summary) <> ''),
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mtg_decisions_meeting
  ON public.mtg_decisions (meeting_id, decided_at DESC);

-- ── Minuta ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_minutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL UNIQUE REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'sent')),
  draft_markdown text,
  approved_markdown text,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  storage_path text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_mtg_minutes_updated_at ON public.mtg_minutes;
CREATE TRIGGER update_mtg_minutes_updated_at
  BEFORE UPDATE ON public.mtg_minutes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Transcripción ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL UNIQUE REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unavailable'
    CHECK (status IN ('unavailable', 'pending', 'ready', 'failed')),
  graph_transcript_id text,
  storage_path text,
  language text,
  received_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_mtg_transcripts_updated_at ON public.mtg_transcripts;
CREATE TRIGGER update_mtg_transcripts_updated_at
  BEFORE UPDATE ON public.mtg_transcripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Vínculo tarea ↔ junta ─────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS mtg_meeting_id uuid REFERENCES public.mtg_meetings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.mtg_meeting_id IS
  'Junta de cliente donde se originó la tarea (modulo Múuch). NULL para tareas normales.';

CREATE INDEX IF NOT EXISTS idx_tasks_mtg_meeting
  ON public.tasks (mtg_meeting_id)
  WHERE mtg_meeting_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.mtg_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_graph_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_transcripts ENABLE ROW LEVEL SECURITY;

-- audit: solo lectura + insert org
DROP POLICY IF EXISTS "mtg_audit_log_select" ON public.mtg_audit_log;
CREATE POLICY "mtg_audit_log_select"
  ON public.mtg_audit_log FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "mtg_audit_log_insert" ON public.mtg_audit_log;
CREATE POLICY "mtg_audit_log_insert"
  ON public.mtg_audit_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "mtg_graph_subscriptions_select" ON public.mtg_graph_subscriptions;
CREATE POLICY "mtg_graph_subscriptions_select"
  ON public.mtg_graph_subscriptions FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "mtg_graph_subscriptions_service" ON public.mtg_graph_subscriptions;
CREATE POLICY "mtg_graph_subscriptions_service"
  ON public.mtg_graph_subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- macro helper for standard org CRUD policies
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mtg_series', 'mtg_meetings', 'mtg_topics', 'mtg_agreements',
    'mtg_decisions', 'mtg_minutes', 'mtg_transcripts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select" ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select" ON public.%1$s FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()))',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert" ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_insert" ON public.%1$s FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_user_org_id(auth.uid()))',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update" ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_update" ON public.%1$s FOR UPDATE TO authenticated USING (organization_id = public.get_user_org_id(auth.uid())) WITH CHECK (organization_id = public.get_user_org_id(auth.uid()))',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete" ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_delete" ON public.%1$s FOR DELETE TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()) AND public.is_admin_or_manager(auth.uid()))',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT ON public.mtg_audit_log TO authenticated;
GRANT SELECT ON public.mtg_graph_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_series TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_topics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_agreements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_minutes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_transcripts TO authenticated;

GRANT ALL ON public.mtg_audit_log TO service_role;
GRANT ALL ON public.mtg_graph_subscriptions TO service_role;
GRANT ALL ON public.mtg_series TO service_role;
GRANT ALL ON public.mtg_meetings TO service_role;
GRANT ALL ON public.mtg_topics TO service_role;
GRANT ALL ON public.mtg_agreements TO service_role;
GRANT ALL ON public.mtg_decisions TO service_role;
GRANT ALL ON public.mtg_minutes TO service_role;
GRANT ALL ON public.mtg_transcripts TO service_role;
