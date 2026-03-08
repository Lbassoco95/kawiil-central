-- Módulo interno del despacho: procedimientos/manuales y comunicados
-- Solo usuarios de la organización (despacho) pueden ver y gestionar

CREATE TABLE public.internal_procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_internal_procedures_org ON public.internal_procedures(organization_id);
CREATE INDEX idx_internal_procedures_created ON public.internal_procedures(created_at DESC);

ALTER TABLE public.internal_procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view internal procedures"
  ON public.internal_procedures FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Org admins and managers can insert internal procedures"
  ON public.internal_procedures FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Org admins and managers can update internal procedures"
  ON public.internal_procedures FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Org admins and managers can delete internal procedures"
  ON public.internal_procedures FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

CREATE TRIGGER update_internal_procedures_updated_at
  BEFORE UPDATE ON public.internal_procedures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comunicados internos
CREATE TABLE public.internal_comunicados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  is_pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_internal_comunicados_org ON public.internal_comunicados(organization_id);
CREATE INDEX idx_internal_comunicados_created ON public.internal_comunicados(created_at DESC);
CREATE INDEX idx_internal_comunicados_pinned ON public.internal_comunicados(is_pinned) WHERE is_pinned = true;

ALTER TABLE public.internal_comunicados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view internal comunicados"
  ON public.internal_comunicados FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Org admins and managers can insert internal comunicados"
  ON public.internal_comunicados FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Org admins and managers can update internal comunicados"
  ON public.internal_comunicados FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Org admins and managers can delete internal comunicados"
  ON public.internal_comunicados FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

CREATE TRIGGER update_internal_comunicados_updated_at
  BEFORE UPDATE ON public.internal_comunicados
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Los archivos se suben al bucket existente "documents" con path "internal/procedures/..."
-- Las RLS de la tabla internal_procedures protegen quién puede crear/ver registros.

-- Permitir eliminar archivos del bucket documents (para borrar procedimientos internos)
CREATE POLICY "Org users can delete documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents');
