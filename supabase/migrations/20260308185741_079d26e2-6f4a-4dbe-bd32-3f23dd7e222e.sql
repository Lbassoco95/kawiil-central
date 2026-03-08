
-- Table for internal procedures (manuales/procedimientos)
CREATE TABLE public.internal_procedures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see internal_procedures"
  ON public.internal_procedures FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admin/manager insert internal_procedures"
  ON public.internal_procedures FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete internal_procedures"
  ON public.internal_procedures FOR DELETE
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Table for internal comunicados
CREATE TABLE public.internal_comunicados (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  title TEXT NOT NULL,
  body TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_comunicados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see internal_comunicados"
  ON public.internal_comunicados FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admin/manager insert internal_comunicados"
  ON public.internal_comunicados FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete internal_comunicados"
  ON public.internal_comunicados FOR DELETE
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
