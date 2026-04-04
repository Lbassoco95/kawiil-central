CREATE OR REPLACE FUNCTION auto_move_stale_leads(days_threshold int DEFAULT 14)
RETURNS int AS $$
DECLARE
  frio_stage_id uuid;
  moved_count int;
BEGIN
  SELECT id INTO frio_stage_id FROM pipeline_stages WHERE slug = 'frio';
  IF frio_stage_id IS NULL THEN RETURN 0; END IF;
  WITH stale AS (
    SELECT l.id, l.stage_id as old_stage_id
    FROM leads l JOIN pipeline_stages ps ON l.stage_id = ps.id
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
