-- =================================================================
-- Migración: Sistema de actividades (lead_tasks) + Campos Softlanding
-- =================================================================

-- 1. Tabla de tareas/actividades programadas por lead
CREATE TABLE IF NOT EXISTS lead_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  title text NOT NULL,
  description text,
  task_type text NOT NULL DEFAULT 'task'
    CHECK (task_type IN ('call', 'email', 'meeting', 'whatsapp', 'task', 'follow_up')),
  due_date timestamptz NOT NULL,
  completed_at timestamptz,
  is_completed boolean DEFAULT false,
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  result text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead ON lead_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_assigned ON lead_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_due ON lead_tasks(due_date) WHERE NOT is_completed;
CREATE INDEX IF NOT EXISTS idx_lead_tasks_overdue ON lead_tasks(due_date, is_completed) WHERE NOT is_completed;

-- RLS
ALTER TABLE lead_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_can_view_tasks" ON lead_tasks;
CREATE POLICY "team_can_view_tasks" ON lead_tasks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "team_can_create_tasks" ON lead_tasks;
CREATE POLICY "team_can_create_tasks" ON lead_tasks
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "team_can_update_tasks" ON lead_tasks;
CREATE POLICY "team_can_update_tasks" ON lead_tasks
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "team_can_delete_tasks" ON lead_tasks;
CREATE POLICY "team_can_delete_tasks" ON lead_tasks
  FOR DELETE TO authenticated USING (
    created_by = auth.uid() OR assigned_to = auth.uid()
  );

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_lead_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_lead_tasks_updated_at ON lead_tasks;
CREATE TRIGGER update_lead_tasks_updated_at
  BEFORE UPDATE ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION update_lead_tasks_timestamp();

-- Habilitar Realtime (idempotente si ya estaba en publicación)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE lead_tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =================================================================
-- 2. Campos Softlanding en tabla leads
-- =================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS country_origin text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_type text
  CHECK (entity_type IN ('sa_cv', 'srl', 'persona_fisica', 'sucursal', 'por_definir'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_budget text
  CHECK (estimated_budget IN ('menos_5k', '5k_15k', '15k_30k', '30k_plus', 'por_definir'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS urgency text DEFAULT 'exploring'
  CHECK (urgency IN ('immediate', 'short_term', 'exploring'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_visa boolean DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS softlanding_notes text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_task_at timestamptz;

-- =================================================================
-- 3. Triggers para last_activity_at y next_task_at
-- =================================================================

-- Actualiza last_activity_at en leads cuando se crea una actividad
CREATE OR REPLACE FUNCTION update_lead_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads
  SET last_activity_at = NEW.created_at
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lead_last_activity ON lead_activities;
CREATE TRIGGER trigger_update_lead_last_activity
  AFTER INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION update_lead_last_activity();

-- Actualiza next_task_at en leads
CREATE OR REPLACE FUNCTION update_lead_next_task()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads
  SET next_task_at = (
    SELECT MIN(due_date) FROM lead_tasks
    WHERE lead_id = COALESCE(NEW.lead_id, OLD.lead_id)
    AND is_completed = false
  )
  WHERE id = COALESCE(NEW.lead_id, OLD.lead_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lead_next_task_insert ON lead_tasks;
CREATE TRIGGER trigger_update_lead_next_task_insert
  AFTER INSERT ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION update_lead_next_task();

DROP TRIGGER IF EXISTS trigger_update_lead_next_task_update ON lead_tasks;
CREATE TRIGGER trigger_update_lead_next_task_update
  AFTER UPDATE ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION update_lead_next_task();

-- Poblar last_activity_at para leads existentes
UPDATE leads l
SET last_activity_at = (
  SELECT MAX(created_at) FROM lead_activities la WHERE la.lead_id = l.id
)
WHERE last_activity_at IS NULL;

-- =================================================================
-- 4. Función para auto-mover leads fríos (opcional, ejecutar manual o con cron)
-- =================================================================

CREATE OR REPLACE FUNCTION auto_move_stale_leads(days_threshold int DEFAULT 14)
RETURNS int AS $$
DECLARE
  frio_stage_id uuid;
  moved_count int;
BEGIN
  SELECT id INTO frio_stage_id FROM pipeline_stages WHERE slug = 'frio';
  IF frio_stage_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH stale AS (
    SELECT l.id, l.stage_id as old_stage_id
    FROM leads l
    JOIN pipeline_stages ps ON l.stage_id = ps.id
    WHERE l.is_active = true
    AND ps.slug NOT IN ('convertido', 'perdido', 'frio')
    AND (l.last_activity_at IS NULL OR l.last_activity_at < now() - (days_threshold || ' days')::interval)
    AND l.created_at < now() - (days_threshold || ' days')::interval
  ),
  updated AS (
    UPDATE leads SET stage_id = frio_stage_id
    FROM stale WHERE leads.id = stale.id
    RETURNING leads.id, stale.old_stage_id
  )
  INSERT INTO lead_activities (lead_id, type, metadata)
  SELECT id, 'stage_change',
    jsonb_build_object('from_stage_id', old_stage_id, 'to_stage_id', frio_stage_id, 'reason', 'auto_stale')
  FROM updated;

  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END;
$$ LANGUAGE plpgsql;
