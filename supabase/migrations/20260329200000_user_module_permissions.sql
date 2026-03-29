-- User module permissions: per-user toggles for each app module
CREATE TABLE IF NOT EXISTS public.user_module_permissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  module_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, module_key)
);

CREATE INDEX idx_ump_user ON public.user_module_permissions(user_id);
CREATE INDEX idx_ump_org ON public.user_module_permissions(organization_id);

ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

-- Users can read their own permissions
CREATE POLICY "Users read own module permissions"
  ON public.user_module_permissions FOR SELECT
  USING (auth.uid() = user_id);

-- Transformadores can read all permissions in their org
CREATE POLICY "Transformadores read org module permissions"
  ON public.user_module_permissions FOR SELECT
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
  );

-- Transformadores can insert permissions in their org
CREATE POLICY "Transformadores insert module permissions"
  ON public.user_module_permissions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
  );

-- Transformadores can update permissions in their org
CREATE POLICY "Transformadores update module permissions"
  ON public.user_module_permissions FOR UPDATE
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
  );

-- Transformadores can delete permissions in their org
CREATE POLICY "Transformadores delete module permissions"
  ON public.user_module_permissions FOR DELETE
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
  );

-- Seed: give all modules to existing transformadores
INSERT INTO public.user_module_permissions (user_id, organization_id, module_key, enabled)
SELECT ur.user_id, p.organization_id, m.key, true
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
CROSS JOIN (VALUES ('ai'), ('finanzas'), ('calendario'), ('correo'), ('documentos'), ('hub'), ('admin')) AS m(key)
WHERE ur.role = 'transformador'
ON CONFLICT (user_id, module_key) DO NOTHING;
