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

CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead ON lead_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_assigned ON lead_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_due ON lead_tasks(due_date) WHERE NOT is_completed;
CREATE INDEX IF NOT EXISTS idx_lead_tasks_overdue ON lead_tasks(due_date, is_completed) WHERE NOT is_completed;

ALTER TABLE lead_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_can_view_tasks" ON lead_tasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "team_can_create_tasks" ON lead_tasks
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "team_can_update_tasks" ON lead_tasks
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "team_can_delete_tasks" ON lead_tasks
  FOR DELETE TO authenticated USING (
    created_by = auth.uid() OR assigned_to = auth.uid()
  );

CREATE OR REPLACE FUNCTION update_lead_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_lead_tasks_updated_at
  BEFORE UPDATE ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION update_lead_tasks_timestamp();

ALTER PUBLICATION supabase_realtime ADD TABLE lead_tasks;

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
