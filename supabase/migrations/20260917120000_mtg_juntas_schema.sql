-- =================================================================
-- Múuch' — Bloque 1: esquema del módulo de Juntas (namespace `mtg_`)
--
-- Múuch' ordena la vida de una junta recurrente o ad hoc con un cliente:
-- la serie (cadencia, agenda base, avisos), cada reunión con su estado,
-- los temas persistentes y sus movimientos por junta, acuerdos, decisiones,
-- próximos pasos y las versiones de la minuta. También deja el gancho para
-- la transcripción de Teams (mtg_graph_subscriptions) y una bitácora
-- append-only (mtg_audit_log).
--
-- Tenancy: el tenant es la ORGANIZACIÓN, no el cliente. Cada tabla con datos
-- lleva `organization_id NOT NULL` (columna de RLS). Una serie se ancla a un
-- cliente (`anchor_type='client'`) o a un grupo de clientes
-- (`anchor_type='group'`); el trigger `mtg_series_validate_anchor` exige que
-- el ancla exista y sea de la misma organización.
--
-- Los timestamps "del día" para deduplicar juntas se calculan en
-- America/Mexico_City: `timestamptz::date` no es IMMUTABLE y no sirve como
-- expresión de índice, por eso se usa `(scheduled_at AT TIME ZONE
-- 'America/Mexico_City')::date`.
--
-- Rollback de acompañamiento: migrations/2026-09-17_mtg_juntas_schema.rollback.sql
-- =================================================================

-- ── 1. La serie: junta recurrente o ad hoc anclada a cliente o grupo ──
CREATE TABLE IF NOT EXISTS public.mtg_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Ancla de la serie: un cliente o un grupo de clientes, ambos de la
  -- misma organización (lo exige el trigger mtg_series_validate_anchor).
  anchor_type text NOT NULL CHECK (anchor_type IN ('client', 'group')),
  anchor_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,

  title text NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'adhoc')),
  default_duration_min int NOT NULL DEFAULT 60,
  -- Fecha/hora de la primera junta; ancla de la generación de instancias.
  starts_at timestamptz,

  -- Quien la lleva (profiles.user_id). Sin FK, igual que responsible_user_id
  -- en el resto del repo.
  owner_user_id uuid,
  attendees_internal uuid[] NOT NULL DEFAULT '{}',
  -- [{name, email}] — asistentes del lado del cliente.
  attendees_client jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{key, label, client_id}] — entidades del grupo (solo series 'group').
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Bloques base de la agenda; el front precarga 5 bloques estándar.
  agenda_template jsonb NOT NULL DEFAULT '[]'::jsonb,

  send_minutes_to_client boolean NOT NULL DEFAULT false,

  -- Transcripción: auto_transcript solo puede activarse si hay constancia
  -- de que el cliente fue informado (transcript_notice_*).
  auto_transcript boolean NOT NULL DEFAULT false,
  transcript_notice_confirmed_at timestamptz,
  transcript_notice_confirmed_by uuid,

  organizer_tenant_id text,
  outlook_event_id text,
  teams_join_url text,

  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (anchor_type <> 'client' OR anchor_id = client_id),
  CHECK (anchor_type <> 'group' OR client_id IS NULL),
  CHECK (auto_transcript = false OR transcript_notice_confirmed_at IS NOT NULL)
);

COMMENT ON TABLE public.mtg_series IS
  'Serie de juntas recurrentes o ad hoc, anclada a un cliente o a un grupo de clientes.';
COMMENT ON COLUMN public.mtg_series.starts_at IS
  'Fecha/hora de la primera junta; ancla de la generación de instancias por cadencia.';
COMMENT ON COLUMN public.mtg_series.entities IS
  'Entidades del grupo: [{key, label, client_id}]. Solo aplica a series anchor_type=group.';

CREATE INDEX IF NOT EXISTS idx_mtg_series_org_anchor
  ON public.mtg_series (organization_id, anchor_type, anchor_id);

-- El ancla debe existir y ser de la misma organización.
CREATE OR REPLACE FUNCTION public.mtg_series_validate_anchor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.anchor_type = 'client' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients
      WHERE id = NEW.anchor_id AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'mtg: cliente % no existe o es de otra organización', NEW.anchor_id;
    END IF;
  ELSIF NEW.anchor_type = 'group' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.client_groups
      WHERE id = NEW.anchor_id AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'mtg: grupo % no existe o es de otra organización', NEW.anchor_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mtg_series_validate_anchor() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_mtg_series_validate_anchor ON public.mtg_series;
CREATE TRIGGER trg_mtg_series_validate_anchor
  BEFORE INSERT OR UPDATE ON public.mtg_series
  FOR EACH ROW EXECUTE FUNCTION public.mtg_series_validate_anchor();

DROP TRIGGER IF EXISTS update_mtg_series_updated_at ON public.mtg_series;
CREATE TRIGGER update_mtg_series_updated_at
  BEFORE UPDATE ON public.mtg_series
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. La junta (instancia) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL en juntas ad hoc. Si la serie se borra, la historia se queda.
  series_id uuid REFERENCES public.mtg_series(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,

  scheduled_at timestamptz NOT NULL,
  duration_min int,
  started_at timestamptz,
  ended_at timestamptz,

  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned', 'in_progress', 'ended', 'minutes_draft', 'minutes_review',
      'minutes_approved', 'closed', 'cancelled', 'no_show'
    )),

  facilitator_user_id uuid,
  note_taker_user_id uuid,

  outlook_event_id text,
  teams_online_meeting_id text,
  teams_join_url text,

  transcript_status text NOT NULL DEFAULT 'not_requested'
    CHECK (transcript_status IN (
      'not_requested', 'subscribed', 'received', 'failed', 'unavailable'
    )),
  transcript_path text,
  recording_path text,
  transcript_unavailable_reason text,

  -- Minuta vigente (FK agregada abajo, mtg_minutes depende de esta tabla).
  minutes_id uuid,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mtg_meetings IS
  'Cada junta: instancia de una serie o ad hoc (series_id NULL).';
COMMENT ON COLUMN public.mtg_meetings.status IS
  'Máquina de estados: planned → in_progress → ended → minutes_draft → minutes_review → minutes_approved → closed. Laterales: cancelled, no_show.';

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_series_date
  ON public.mtg_meetings (series_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_org_client
  ON public.mtg_meetings (organization_id, client_id);

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_status_date
  ON public.mtg_meetings (status, scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mtg_meetings_teams_online
  ON public.mtg_meetings (teams_online_meeting_id)
  WHERE teams_online_meeting_id IS NOT NULL;

-- Una junta por serie por día (día en hora de México; timestamptz::date no
-- es IMMUTABLE y no se puede indexar directo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtg_meetings_series_day
  ON public.mtg_meetings (series_id, ((scheduled_at AT TIME ZONE 'America/Mexico_City')::date))
  WHERE series_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_mtg_meetings_updated_at ON public.mtg_meetings;
CREATE TRIGGER update_mtg_meetings_updated_at
  BEFORE UPDATE ON public.mtg_meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3. Temas persistentes de la serie ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES public.mtg_series(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_key text,
  default_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,

  title text NOT NULL,
  context text,
  -- Qué decir si el cliente saca el tema.
  source text,
  if_asked text,

  owner_side text CHECK (owner_side IS NULL OR owner_side IN ('kawiil', 'client', 'both')),
  owner_user_id uuid,
  owner_name text,
  due_date date,

  linked_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dropped')),
  dropped_reason text,

  created_in_meeting_id uuid REFERENCES public.mtg_meetings(id) ON DELETE SET NULL,
  resolved_in_meeting_id uuid REFERENCES public.mtg_meetings(id) ON DELETE SET NULL,

  -- Llave del tema en el documento/agenda de origen (importación).
  legacy_key text,
  sort_order int,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mtg_topics IS
  'Temas persistentes de una serie: viven entre juntas hasta resolverse o descartarse.';

CREATE INDEX IF NOT EXISTS idx_mtg_topics_series_status
  ON public.mtg_topics (series_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mtg_topics_legacy_key
  ON public.mtg_topics (series_id, legacy_key)
  WHERE legacy_key IS NOT NULL;

DROP TRIGGER IF EXISTS update_mtg_topics_updated_at ON public.mtg_topics;
CREATE TRIGGER update_mtg_topics_updated_at
  BEFORE UPDATE ON public.mtg_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Movimiento de un tema en una junta ───────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_topic_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.mtg_topics(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,

  movement text NOT NULL
    CHECK (movement IN (
      'resolved', 'advanced', 'unchanged', 'new',
      'decision_needed', 'blocked_third_party', 'waiting_authority'
    )),
  progress_since_last text,
  next_step text,
  session_notes text,

  reviewed boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by uuid,

  origin text NOT NULL DEFAULT 'prepared'
    CHECK (origin IN ('prepared', 'edited_live', 'proposed_by_model')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (topic_id, meeting_id)
);

COMMENT ON TABLE public.mtg_topic_updates IS
  'Movimiento de un tema en una junta concreta (uno por tema por junta).';

DROP TRIGGER IF EXISTS update_mtg_topic_updates_updated_at ON public.mtg_topic_updates;
CREATE TRIGGER update_mtg_topic_updates_updated_at
  BEFORE UPDATE ON public.mtg_topic_updates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Agenda de la junta ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,

  sort_order int,
  title text,
  kind text CHECK (kind IS NULL OR kind IN ('section', 'topic', 'decision', 'free')),
  topic_id uuid REFERENCES public.mtg_topics(id) ON DELETE SET NULL,
  decision_id uuid,  -- FK agregada abajo (mtg_decisions se crea después).

  source text CHECK (source IS NULL OR source IN (
    'template', 'carried_over', 'added_by_team', 'from_task', 'from_deadline'
  )),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'skipped', 'deferred')),
  reviewed_at timestamptz,
  reviewed_by uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mtg_agenda_items IS
  'Bloques de la agenda de una junta: secciones, temas, decisiones y puntos libres.';

DROP TRIGGER IF EXISTS update_mtg_agenda_items_updated_at ON public.mtg_agenda_items;
CREATE TRIGGER update_mtg_agenda_items_updated_at
  BEFORE UPDATE ON public.mtg_agenda_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 6. Decisiones tomadas en la junta ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  entity_key text,
  topic_id uuid REFERENCES public.mtg_topics(id) ON DELETE SET NULL,

  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'decided', 'deferred')),
  resolution text,
  decided_by_name text,
  decided_at timestamptz,

  agreement_id uuid,  -- FK agregada abajo (mtg_agreements se crea después).
  sort_order int,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mtg_decisions IS
  'Decisiones levantadas en una junta; si generan compromiso, apuntan al acuerdo.';

DROP TRIGGER IF EXISTS update_mtg_decisions_updated_at ON public.mtg_decisions;
CREATE TRIGGER update_mtg_decisions_updated_at
  BEFORE UPDATE ON public.mtg_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 7. Lo que se espera para la próxima junta ───────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_expected_next (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  entity_key text,
  topic_id uuid REFERENCES public.mtg_topics(id) ON DELETE SET NULL,

  text text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  sort_order int,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mtg_expected_next IS
  'Compromisos "esperados para la próxima" anotados al cierre de la junta.';

-- ── 8. Acuerdos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_key text,
  topic_id uuid REFERENCES public.mtg_topics(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,

  text text NOT NULL,
  owner_side text CHECK (owner_side IS NULL OR owner_side IN ('kawiil', 'client', 'both')),
  owner_user_id uuid,
  owner_name text,
  due_date date,

  origin text NOT NULL
    CHECK (origin IN ('captured_live', 'proposed_by_model', 'added_in_review')),
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  rejected_reason text,

  -- A qué proyecto convertirlo en tarea cuando se confirme.
  project_hint uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  project_reason text,
  transcript_ref text,
  confidence numeric,

  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Solo un acuerdo confirmado y ya asignado a proyecto puede tener tarea.
  CHECK (task_id IS NULL OR (status = 'confirmed' AND project_id IS NOT NULL))
);

COMMENT ON TABLE public.mtg_agreements IS
  'Compromisos capturados en la junta. Los propuestos por el modelo nacen proposed y se confirman en revisión.';
COMMENT ON COLUMN public.mtg_agreements.transcript_ref IS
  'Referencia al segmento de transcripción que respalda el acuerdo (offset o id del chunk).';

CREATE INDEX IF NOT EXISTS idx_mtg_agreements_meeting
  ON public.mtg_agreements (meeting_id);

CREATE INDEX IF NOT EXISTS idx_mtg_agreements_client_project
  ON public.mtg_agreements (client_id, project_id);

DROP TRIGGER IF EXISTS update_mtg_agreements_updated_at ON public.mtg_agreements;
CREATE TRIGGER update_mtg_agreements_updated_at
  BEFORE UPDATE ON public.mtg_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 9. Minutas ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_minutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  version int NOT NULL,

  status text NOT NULL
    CHECK (status IN ('draft', 'in_review', 'approved', 'superseded')),
  content_md text,
  generated_by text CHECK (generated_by IS NULL OR generated_by IN ('model', 'human')),
  model_version text,
  prompt_version text,

  approved_by uuid,
  approved_at timestamptz,

  -- La minuta aprobada SÍ se registra siempre como fila de public.documents
  -- (client_id, document_type='minuta', file_path al objeto del bucket `mtg`,
  -- metadata.bucket='mtg', metadata.meeting_id) para que aparezca en la
  -- pestaña Documentos; document_id apunta a esa fila. document_path es la
  -- ruta del objeto en el bucket `mtg`.
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  document_path text,

  sent_to_client_at timestamptz,
  sent_to jsonb,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (meeting_id, version)
);

COMMENT ON TABLE public.mtg_minutes IS
  'Versiones de la minuta de una junta. A lo más una aprobada por junta.';

-- A lo más una minuta aprobada por junta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtg_minutes_approved
  ON public.mtg_minutes (meeting_id)
  WHERE status = 'approved';

DROP TRIGGER IF EXISTS update_mtg_minutes_updated_at ON public.mtg_minutes;
CREATE TRIGGER update_mtg_minutes_updated_at
  BEFORE UPDATE ON public.mtg_minutes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 10. Suscripciones de Microsoft Graph (transcripciones de Teams) ──
-- La escribe el worker con service_role; el navegador no la toca.
CREATE TABLE IF NOT EXISTS public.mtg_graph_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  subscription_id text UNIQUE,
  resource text,
  change_type text,
  expires_at timestamptz,
  lifecycle_state text,
  last_renewed_at timestamptz,
  client_state_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mtg_graph_subscriptions IS
  'Suscripciones de notificación de Microsoft Graph para transcripciones de Teams. Solo service_role.';

DROP TRIGGER IF EXISTS update_mtg_graph_subscriptions_updated_at ON public.mtg_graph_subscriptions;
CREATE TRIGGER update_mtg_graph_subscriptions_updated_at
  BEFORE UPDATE ON public.mtg_graph_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.mtg_graph_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mtg_graph_subscriptions_service" ON public.mtg_graph_subscriptions;
CREATE POLICY "mtg_graph_subscriptions_service"
  ON public.mtg_graph_subscriptions FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.mtg_graph_subscriptions FROM authenticated, anon;
GRANT ALL ON public.mtg_graph_subscriptions TO service_role;

-- ── 11. Bitácora del módulo (append-only) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  entity_type text NOT NULL
    CHECK (entity_type IN (
      'series', 'meeting', 'topic', 'agreement', 'decision', 'minutes', 'transcript'
    )),
  entity_id uuid,
  action text NOT NULL,
  snapshot jsonb,
  details jsonb
);

COMMENT ON TABLE public.mtg_audit_log IS
  'Bitácora append-only del módulo de Juntas. UPDATE y DELETE están prohibidos por trigger y por permisos.';

CREATE INDEX IF NOT EXISTS idx_mtg_audit_log_org_time
  ON public.mtg_audit_log (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_mtg_audit_log_entity
  ON public.mtg_audit_log (entity_type, entity_id);

CREATE OR REPLACE FUNCTION public.mtg_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'mtg_audit_log es append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.mtg_audit_log_immutable() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_mtg_audit_log_immutable ON public.mtg_audit_log;
CREATE TRIGGER trg_mtg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.mtg_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.mtg_audit_log_immutable();

ALTER TABLE public.mtg_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mtg_audit_log_select" ON public.mtg_audit_log;
CREATE POLICY "mtg_audit_log_select"
  ON public.mtg_audit_log FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "mtg_audit_log_insert" ON public.mtg_audit_log;
CREATE POLICY "mtg_audit_log_insert"
  ON public.mtg_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND actor_user_id = auth.uid()
  );

-- Nadie actualiza ni borra la bitácora: ni usuarios ni el worker.
REVOKE UPDATE, DELETE ON public.mtg_audit_log FROM authenticated, anon, service_role;
GRANT SELECT, INSERT ON public.mtg_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.mtg_audit_log TO service_role;

-- ── 12. FKs cruzadas que no cabían en el CREATE TABLE ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mtg_meetings_minutes_id_fkey'
  ) THEN
    ALTER TABLE public.mtg_meetings
      ADD CONSTRAINT mtg_meetings_minutes_id_fkey
      FOREIGN KEY (minutes_id) REFERENCES public.mtg_minutes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mtg_agenda_items_decision_id_fkey'
  ) THEN
    ALTER TABLE public.mtg_agenda_items
      ADD CONSTRAINT mtg_agenda_items_decision_id_fkey
      FOREIGN KEY (decision_id) REFERENCES public.mtg_decisions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mtg_decisions_agreement_id_fkey'
  ) THEN
    ALTER TABLE public.mtg_decisions
      ADD CONSTRAINT mtg_decisions_agreement_id_fkey
      FOREIGN KEY (agreement_id) REFERENCES public.mtg_agreements(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Una tarea puede nacer de una junta (mismo patrón que tasks.activity_id).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS mtg_meeting_id uuid
  REFERENCES public.mtg_meetings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.mtg_meeting_id IS
  'Junta de la que nació la tarea (módulo Juntas). NULL para tareas normales.';

CREATE INDEX IF NOT EXISTS idx_tasks_mtg_meeting
  ON public.tasks(mtg_meeting_id) WHERE mtg_meeting_id IS NOT NULL;

-- ── 13. Generación de instancias de una serie ───────────────────────
-- Inserta las próximas _count juntas según la cadencia, sin duplicar el día.
-- SECURITY INVOKER: la RLS del usuario que la llama es la que manda.
CREATE OR REPLACE FUNCTION public.mtg_generate_series_meetings(
  _series_id uuid,
  _count int DEFAULT 8
)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s public.mtg_series%ROWTYPE;
  v_inserted int := 0;
BEGIN
  SELECT * INTO s FROM public.mtg_series WHERE id = _series_id;
  IF NOT FOUND OR s.cadence = 'adhoc' OR s.starts_at IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.mtg_meetings (
    organization_id, series_id, client_id, scheduled_at, duration_min,
    status, facilitator_user_id, created_by
  )
  SELECT
    s.organization_id,
    s.id,
    s.client_id,
    cand.scheduled_at,
    s.default_duration_min,
    'planned',
    s.owner_user_id,
    auth.uid()
  FROM generate_series(0, _count - 1) AS i
  CROSS JOIN LATERAL (
    SELECT CASE s.cadence
      WHEN 'weekly'   THEN s.starts_at + (i * interval '7 days')
      WHEN 'biweekly' THEN s.starts_at + (i * interval '14 days')
      WHEN 'monthly'  THEN s.starts_at + (i * interval '1 month')
    END AS scheduled_at
  ) AS cand
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mtg_meetings m
    WHERE m.series_id = s.id
      AND (m.scheduled_at AT TIME ZONE 'America/Mexico_City')::date
        = (cand.scheduled_at AT TIME ZONE 'America/Mexico_City')::date
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.mtg_generate_series_meetings(uuid, int) IS
  'Genera las próximas _count juntas de una serie según su cadencia. Devuelve cuántas insertó; series adhoc o sin starts_at devuelven 0.';

GRANT EXECUTE ON FUNCTION public.mtg_generate_series_meetings(uuid, int) TO authenticated;

-- ── 14. RLS de las tablas con datos ─────────────────────────────────
-- Aisladas por organización, como el resto del repo. DELETE solo
-- admin/manager: la historia de juntas es auditoría de lo que pasó.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mtg_series', 'mtg_meetings', 'mtg_topics', 'mtg_topic_updates',
    'mtg_agenda_items', 'mtg_decisions', 'mtg_expected_next',
    'mtg_agreements', 'mtg_minutes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (organization_id = public.get_user_org_id(auth.uid()))', t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
         WITH CHECK (organization_id = public.get_user_org_id(auth.uid()))', t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
         USING (organization_id = public.get_user_org_id(auth.uid()))
         WITH CHECK (organization_id = public.get_user_org_id(auth.uid()))', t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
         USING (
           organization_id = public.get_user_org_id(auth.uid())
           AND public.is_admin_or_manager(auth.uid())
         )', t || '_delete', t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
