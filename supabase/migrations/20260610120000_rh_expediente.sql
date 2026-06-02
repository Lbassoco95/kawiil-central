-- =============================================================
-- RH — Expediente digital del colaborador (onboarding)
-- El colaborador captura/actualiza sus datos fiscales y personales y
-- sube sus documentos (INE, CURP, RFC/CSF, NSS, domicilio, CLABE, acta,
-- estudios). Solo G4 (transformador) ve todos los expedientes y marca
-- cada documento como verificado/rechazado.
-- =============================================================

-- ---------------- Datos estructurados (1:1 con el usuario) ----------------
CREATE TABLE IF NOT EXISTS public.rh_employee_profile (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfc                     text,
  curp                    text,
  nss                     text,
  clabe                   text,
  bank_name               text,
  birth_date              date,
  address                 text,
  postal_code             text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------------- Documentos del expediente ----------------
-- Un registro por (usuario, tipo de documento); se reemplaza al resubir.
CREATE TABLE IF NOT EXISTS public.rh_employee_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type        text NOT NULL,
  file_path       text NOT NULL,
  file_name       text,
  status          text NOT NULL DEFAULT 'uploaded',   -- uploaded | verified | rejected
  note            text,
  verified_by     uuid REFERENCES auth.users(id),
  verified_at     timestamptz,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, doc_type)
);
CREATE INDEX IF NOT EXISTS idx_rh_empdoc_user ON public.rh_employee_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_rh_empdoc_org ON public.rh_employee_documents(organization_id);

ALTER TABLE public.rh_employee_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_employee_documents ENABLE ROW LEVEL SECURITY;

-- ----- RLS datos: dueño gestiona lo suyo; G4 ve todo en su org -----
DROP POLICY IF EXISTS "Owner manages own employee profile" ON public.rh_employee_profile;
CREATE POLICY "Owner manages own employee profile" ON public.rh_employee_profile
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "G4 reads employee profiles" ON public.rh_employee_profile;
CREATE POLICY "G4 reads employee profiles" ON public.rh_employee_profile
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- ----- RLS documentos: dueño gestiona los suyos; G4 ve y verifica -----
DROP POLICY IF EXISTS "Owner manages own employee documents" ON public.rh_employee_documents;
CREATE POLICY "Owner manages own employee documents" ON public.rh_employee_documents
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "G4 manages employee documents" ON public.rh_employee_documents;
CREATE POLICY "G4 manages employee documents" ON public.rh_employee_documents
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- =============================================================
-- Storage — bucket privado del expediente
-- Ruta: {organization_id}/{user_id}/{archivo}
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('expedientes', 'expedientes', false)
ON CONFLICT (id) DO NOTHING;

-- Dueño: lee/escribe bajo su propia carpeta {org}/{user_id}/...
DROP POLICY IF EXISTS "Expediente owner all" ON storage.objects;
CREATE POLICY "Expediente owner all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'expedientes' AND (storage.foldername(name))[2] = auth.uid()::text)
  WITH CHECK (bucket_id = 'expedientes' AND (storage.foldername(name))[2] = auth.uid()::text);

-- G4: lectura de todos los expedientes de la organización.
DROP POLICY IF EXISTS "Expediente G4 read" ON storage.objects;
CREATE POLICY "Expediente G4 read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'expedientes' AND public.has_role(auth.uid(), 'transformador'));
