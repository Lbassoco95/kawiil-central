CREATE OR REPLACE FUNCTION update_lead_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads SET last_activity_at = NEW.created_at WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lead_last_activity ON lead_activities;
CREATE TRIGGER trigger_update_lead_last_activity
  AFTER INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION update_lead_last_activity();

CREATE OR REPLACE FUNCTION update_lead_next_task()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads SET next_task_at = (
    SELECT MIN(due_date) FROM lead_tasks
    WHERE lead_id = COALESCE(NEW.lead_id, OLD.lead_id)
    AND is_completed = false
  ) WHERE id = COALESCE(NEW.lead_id, OLD.lead_id);
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
