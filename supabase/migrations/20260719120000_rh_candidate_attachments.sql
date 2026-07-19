-- =============================================================
-- RH — Reclutamiento: adjuntos múltiples por candidato
--   Permite subir más de un archivo por candidato, cada uno con un
--   nombre/comentario que describe qué es. Los archivos viven en el bucket
--   privado 'cv'; aquí solo guardamos su ruta y metadatos.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rh_candidate_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id    uuid NOT NULL REFERENCES public.rh_candidates(id) ON DELETE CASCADE,
  file_path       text NOT NULL,
  file_name       text NOT NULL,
  label           text,
  content_type    text,
  size_bytes      bigint,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rh_cand_attach ON public.rh_candidate_attachments(candidate_id, created_at DESC);

ALTER TABLE public.rh_candidate_attachments ENABLE ROW LEVEL SECURITY;

-- Mismos permisos que el resto del módulo: reclutadores (permiso o G4) de la organización.
DROP POLICY IF EXISTS "Recruiters manage rh_candidate_attachments" ON public.rh_candidate_attachments;
CREATE POLICY "Recruiters manage rh_candidate_attachments" ON public.rh_candidate_attachments FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));
