
-- 1. Add 'cumplimiento' to service_area enum
ALTER TYPE public.service_area ADD VALUE IF NOT EXISTS 'cumplimiento';

-- 2. Create compliance_entity_types catalog
CREATE TABLE public.compliance_entity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  group_name text NOT NULL, -- 'CNBV' | 'ACTIVIDAD_VULNERABLE'
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_entity_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read compliance entity types"
  ON public.compliance_entity_types FOR SELECT
  TO authenticated
  USING (true);

-- 3. Create client_compliance_config
CREATE TABLE public.client_compliance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_type_id uuid NOT NULL REFERENCES public.compliance_entity_types(id),
  registration_number text,
  authorization_date date,
  compliance_officer_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_compliance_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see client compliance config"
  ON public.client_compliance_config FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org users create client compliance config"
  ON public.client_compliance_config FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org users update client compliance config"
  ON public.client_compliance_config FOR UPDATE
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admin/manager delete client compliance config"
  ON public.client_compliance_config FOR DELETE
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- 4. Create compliance_task_templates
CREATE TABLE public.compliance_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL REFERENCES public.compliance_entity_types(id),
  task_name text NOT NULL,
  description text,
  category text NOT NULL,
  periodicity text NOT NULL,
  due_day integer,
  due_month integer,
  due_month_2 integer,
  due_description text,
  legal_basis text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_task_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read compliance task templates"
  ON public.compliance_task_templates FOR SELECT
  TO authenticated
  USING (true);

-- 5. Add compliance columns to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS compliance_template_id uuid REFERENCES public.compliance_task_templates(id),
  ADD COLUMN IF NOT EXISTS compliance_periodicity text,
  ADD COLUMN IF NOT EXISTS compliance_period text;
