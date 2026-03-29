-- 1. Seed "conocimiento" permission for existing transformadores
INSERT INTO public.user_module_permissions (user_id, organization_id, module_key, enabled)
SELECT ur.user_id, p.organization_id, 'conocimiento', true
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
WHERE ur.role = 'transformador'
ON CONFLICT (user_id, module_key) DO NOTHING;

-- 2. Client groups
CREATE TABLE IF NOT EXISTS public.client_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_group_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES public.client_groups(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, client_id)
);

CREATE INDEX idx_cg_org ON public.client_groups(organization_id);
CREATE INDEX idx_cgm_group ON public.client_group_members(group_id);
CREATE INDEX idx_cgm_client ON public.client_group_members(client_id);

ALTER TABLE public.client_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read org client groups" ON public.client_groups FOR SELECT
  USING (organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()));

CREATE POLICY "Referentes+ manage client groups" ON public.client_groups FOR ALL
  USING (
    organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('transformador', 'referente')
    )
  );

CREATE POLICY "Users read org group members" ON public.client_group_members FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM public.client_groups
      WHERE organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
    )
  );

CREATE POLICY "Referentes+ manage group members" ON public.client_group_members FOR ALL
  USING (
    group_id IN (
      SELECT id FROM public.client_groups
      WHERE organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.role IN ('transformador', 'referente')
        )
    )
  );

-- 3. Project templates
CREATE TABLE IF NOT EXISTS public.project_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  area text,
  phases jsonb NOT NULL DEFAULT '[]',
  suggested_tasks jsonb NOT NULL DEFAULT '[]',
  is_ai_generated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pt_org ON public.project_templates(organization_id);
CREATE INDEX idx_pt_area ON public.project_templates(area);

ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read org templates" ON public.project_templates FOR SELECT
  USING (organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()));

CREATE POLICY "Referentes+ manage templates" ON public.project_templates FOR ALL
  USING (
    organization_id IN (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('transformador', 'referente')
    )
  );
