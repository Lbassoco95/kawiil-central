
CREATE TABLE public.savio_webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  savio_id text,
  status text NOT NULL DEFAULT 'received',
  processed_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.savio_webhook_events ENABLE ROW LEVEL SECURITY;

-- Admin/manager can view webhook events
CREATE POLICY "Admin/manager see savio events"
  ON public.savio_webhook_events
  FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
