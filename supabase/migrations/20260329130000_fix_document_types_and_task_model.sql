-- Migration: fix_document_types_and_task_model
-- Date: 2026-03-29
--
-- DATA MODEL NOTES:
--
--   documents.document_type (TEXT)
--     Legacy free-text field (e.g. "contabilidad"). Kept for backward
--     compatibility. New code should write to document_type_id instead.
--
--   documents.document_type_id (UUID → document_types.id)
--     Proper FK to the document_types catalog. Preferred for queries,
--     filters and joins. Nullable so existing rows are unaffected.
--
--   tasks.assigned_to (UUID)
--     The "primary" assignee of a task.
--
--   task_assignees (task_id, user_id)
--     Additional co-assignees. A user may appear here AND in assigned_to.
--
--   v_task_all_assignees (VIEW)
--     Unifies both assignment sources into a single rowset with an
--     assignment_type column ('primary' | 'co-assignee').
-- -----------------------------------------------------------------------

-- 1. Add document_type_id column with FK to document_types catalog
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'documents'
      AND column_name = 'document_type_id'
  ) THEN
    ALTER TABLE public.documents
      ADD COLUMN document_type_id uuid
        REFERENCES public.document_types(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_documents_type_id
      ON public.documents(document_type_id);
  END IF;
END $$;

COMMENT ON COLUMN public.documents.document_type
  IS 'Legacy free-text document type. Use document_type_id for catalog reference.';
COMMENT ON COLUMN public.documents.document_type_id
  IS 'FK to document_types catalog. Preferred over document_type text field.';

-- 2. Unified view for task assignments (primary + co-assignees)
CREATE OR REPLACE VIEW public.v_task_all_assignees AS
SELECT
  t.id AS task_id,
  t.title,
  t.organization_id,
  COALESCE(ta.user_id, t.assigned_to) AS user_id,
  CASE
    WHEN ta.user_id IS NOT NULL AND ta.user_id = t.assigned_to THEN 'primary'
    WHEN ta.user_id IS NOT NULL THEN 'co-assignee'
    ELSE 'primary'
  END AS assignment_type
FROM public.tasks t
LEFT JOIN public.task_assignees ta ON ta.task_id = t.id
WHERE t.assigned_to IS NOT NULL
   OR ta.user_id IS NOT NULL;

COMMENT ON VIEW public.v_task_all_assignees
  IS 'Unified view of task assignments: merges tasks.assigned_to (primary) with task_assignees (co-assignees).';
