ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_ref text;

CREATE INDEX IF NOT EXISTS notifications_entity_ref_slack_idx
  ON public.notifications (user_id, entity_ref)
  WHERE entity_type = 'slack' AND is_read = false;