-- Version tracking for procedure files
CREATE TABLE public.procedure_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id uuid NOT NULL REFERENCES public.internal_procedures(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid,
  change_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.procedure_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see procedure versions"
  ON public.procedure_versions FOR SELECT
  TO authenticated
  USING (
    procedure_id IN (
      SELECT id FROM public.internal_procedures
      WHERE organization_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Admin/manager insert procedure versions"
  ON public.procedure_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    procedure_id IN (
      SELECT id FROM public.internal_procedures
      WHERE organization_id = get_user_org_id(auth.uid())
    )
    AND is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Admin/manager delete procedure versions"
  ON public.procedure_versions FOR DELETE
  TO authenticated
  USING (
    procedure_id IN (
      SELECT id FROM public.internal_procedures
      WHERE organization_id = get_user_org_id(auth.uid())
    )
    AND is_admin_or_manager(auth.uid())
  );

-- Comments on procedures
CREATE TABLE public.procedure_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id uuid NOT NULL REFERENCES public.internal_procedures(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.procedure_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see procedure comments"
  ON public.procedure_comments FOR SELECT
  TO authenticated
  USING (
    procedure_id IN (
      SELECT id FROM public.internal_procedures
      WHERE organization_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Authenticated users create procedure comments"
  ON public.procedure_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND procedure_id IN (
      SELECT id FROM public.internal_procedures
      WHERE organization_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users delete own procedure comments"
  ON public.procedure_comments FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_admin_or_manager(auth.uid())
  );

-- Add current_version to procedures for quick reference
ALTER TABLE public.internal_procedures ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;