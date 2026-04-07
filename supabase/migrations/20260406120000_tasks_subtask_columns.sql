-- Subtasks: explicit parent link and list filtering flag
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS is_subtask boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tasks.parent_task_id IS 'Board task that owns this row as a checklist-linked subtask (NULL for project-step subtasks).';
COMMENT ON COLUMN public.tasks.is_subtask IS 'True when this task was created as a linked subtask (hidden from default board lists).';

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON public.tasks(parent_task_id)
  WHERE parent_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_organization_id_is_subtask ON public.tasks(organization_id, is_subtask);

-- Backfill: parent.checklist[].task_id -> child.parent_task_id, is_subtask
UPDATE public.tasks AS child
SET
  parent_task_id = src.parent_id,
  is_subtask = true
FROM (
  SELECT DISTINCT
    t.id AS parent_id,
    (elem->>'task_id')::uuid AS child_id
  FROM public.tasks t,
  LATERAL jsonb_array_elements(COALESCE(t.checklist, '[]'::jsonb)) AS elem
  WHERE elem ? 'task_id'
    AND nullif(trim(elem->>'task_id'), '') IS NOT NULL
    AND trim(elem->>'task_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
) AS src
WHERE child.id = src.child_id
  AND src.parent_id IS NOT NULL
  AND src.child_id IS NOT NULL;
