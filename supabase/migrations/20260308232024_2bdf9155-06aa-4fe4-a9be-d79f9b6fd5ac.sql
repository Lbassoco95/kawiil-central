
-- Create notifications table for @mentions and other alerts
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'mention',
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  source_user_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id)
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- System/authenticated users can insert notifications for org members
CREATE POLICY "Org users create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

-- Users can delete their own notifications
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Create project_comments table
CREATE TABLE public.project_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  mentions uuid[] DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see project comments" ON public.project_comments
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE organization_id = get_user_org_id(auth.uid())));

CREATE POLICY "Org users create project comments" ON public.project_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND project_id IN (SELECT id FROM projects WHERE organization_id = get_user_org_id(auth.uid())));

CREATE POLICY "Users delete own project comments" ON public.project_comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin_or_manager(auth.uid()));
