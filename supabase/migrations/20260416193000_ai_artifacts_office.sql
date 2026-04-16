-- =============================================================
-- AI Artifacts: support Office documents with metadata
-- =============================================================

ALTER TABLE public.ai_artifacts
  ADD COLUMN IF NOT EXISTS office_kind text,
  ADD COLUMN IF NOT EXISTS file_ext text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS external_file_id text;

UPDATE public.ai_artifacts
SET storage_bucket = COALESCE(storage_bucket, 'documents')
WHERE content_type = 'office'
  AND storage_path IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_artifacts_content_type_check'
      AND table_schema = 'public'
      AND table_name = 'ai_artifacts'
  ) THEN
    ALTER TABLE public.ai_artifacts DROP CONSTRAINT ai_artifacts_content_type_check;
  END IF;
END $$;

ALTER TABLE public.ai_artifacts
  ADD CONSTRAINT ai_artifacts_content_type_check
  CHECK (content_type IN ('markdown', 'code', 'html', 'csv', 'office'));

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_artifacts_office_kind_check'
      AND table_schema = 'public'
      AND table_name = 'ai_artifacts'
  ) THEN
    ALTER TABLE public.ai_artifacts DROP CONSTRAINT ai_artifacts_office_kind_check;
  END IF;
END $$;

ALTER TABLE public.ai_artifacts
  ADD CONSTRAINT ai_artifacts_office_kind_check
  CHECK (
    office_kind IS NULL OR office_kind IN ('spreadsheet', 'word_document', 'presentation')
  );

CREATE INDEX IF NOT EXISTS idx_ai_artifacts_office_storage
  ON public.ai_artifacts (storage_bucket, storage_path)
  WHERE storage_path IS NOT NULL;
