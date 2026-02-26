
-- Table for multiple assignees per task
CREATE TABLE public.task_assignees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

-- Org users can see task assignees
CREATE POLICY "Org users see task assignees" ON public.task_assignees
  FOR SELECT USING (
    task_id IN (SELECT t.id FROM tasks t WHERE t.organization_id = get_user_org_id(auth.uid()))
  );

-- Org users can manage task assignees
CREATE POLICY "Org users manage task assignees" ON public.task_assignees
  FOR INSERT WITH CHECK (
    task_id IN (SELECT t.id FROM tasks t WHERE t.organization_id = get_user_org_id(auth.uid()))
  );

CREATE POLICY "Org users delete task assignees" ON public.task_assignees
  FOR DELETE USING (
    task_id IN (SELECT t.id FROM tasks t WHERE t.organization_id = get_user_org_id(auth.uid()))
  );

-- Add dropbox_links column to tasks for storing Dropbox links
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS dropbox_links jsonb DEFAULT '[]'::jsonb;
