-- Archivos (cotizaciones, diseños, muestras) de una actividad + votación.
-- Permite subir imágenes/documentos para dar seguimiento a la SELECCIÓN de
-- proveedores/muestras y que el equipo VOTE por su favorita.
-- Los archivos viven en el bucket de Storage `documents` (privado, URL firmada);
-- aquí se guarda solo la metadata + el path, siguiendo el patrón de `documents`.

-- ─── Archivos de la actividad ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.activity_providers(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'cotizacion',
  name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_files_kind_check
    CHECK (kind IN ('cotizacion', 'diseno', 'muestra', 'otro'))
);

CREATE INDEX IF NOT EXISTS idx_activity_files_activity ON public.activity_files (activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_files_org ON public.activity_files (organization_id);

ALTER TABLE public.activity_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_files_select_org" ON public.activity_files;
CREATE POLICY "activity_files_select_org"
  ON public.activity_files FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_files_insert_org" ON public.activity_files;
CREATE POLICY "activity_files_insert_org"
  ON public.activity_files FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND organization_id = get_user_org_id(auth.uid())
    AND activity_id IN (SELECT id FROM public.activities WHERE organization_id = get_user_org_id(auth.uid()))
  );

DROP POLICY IF EXISTS "activity_files_update_org" ON public.activity_files;
CREATE POLICY "activity_files_update_org"
  ON public.activity_files FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_files_delete_org" ON public.activity_files;
CREATE POLICY "activity_files_delete_org"
  ON public.activity_files FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_files TO authenticated;
GRANT ALL ON public.activity_files TO service_role;

DROP TRIGGER IF EXISTS set_activity_files_updated_at ON public.activity_files;
CREATE TRIGGER set_activity_files_updated_at
  BEFORE UPDATE ON public.activity_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Votos por archivo (un voto por persona por archivo) ─────────────────────
CREATE TABLE IF NOT EXISTS public.activity_file_votes (
  activity_file_id uuid NOT NULL REFERENCES public.activity_files(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_file_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_file_votes_file ON public.activity_file_votes (activity_file_id);

ALTER TABLE public.activity_file_votes ENABLE ROW LEVEL SECURITY;

-- Todos en la organización ven los votos (para contar); cada quien maneja el suyo.
DROP POLICY IF EXISTS "activity_file_votes_select_org" ON public.activity_file_votes;
CREATE POLICY "activity_file_votes_select_org"
  ON public.activity_file_votes FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_file_votes_insert_own" ON public.activity_file_votes;
CREATE POLICY "activity_file_votes_insert_own"
  ON public.activity_file_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_file_votes_delete_own" ON public.activity_file_votes;
CREATE POLICY "activity_file_votes_delete_own"
  ON public.activity_file_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.activity_file_votes TO authenticated;
GRANT ALL ON public.activity_file_votes TO service_role;
