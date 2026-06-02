-- =============================================================
-- RH — Reclutamiento: estados personalizados por vacante + CV
-- Estados configurables (antes era un enum fijo) y bucket privado
-- para los CV de los candidatos.
-- =============================================================

-- ---------------- Estados por proceso ----------------
CREATE TABLE IF NOT EXISTS public.rh_recruitment_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  process_id      uuid NOT NULL REFERENCES public.rh_recruitment_processes(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text NOT NULL DEFAULT 'slate',
  position        integer NOT NULL DEFAULT 0,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_state_proc ON public.rh_recruitment_states(process_id, position);

-- Candidato → estado personalizado.
ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS state_id uuid REFERENCES public.rh_recruitment_states(id) ON DELETE SET NULL;

ALTER TABLE public.rh_recruitment_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recruiters manage rh_recruitment_states" ON public.rh_recruitment_states;
CREATE POLICY "Recruiters manage rh_recruitment_states" ON public.rh_recruitment_states
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));

-- ---- Seed de estados por defecto para procesos existentes ----
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id, organization_id FROM public.rh_recruitment_processes LOOP
    IF NOT EXISTS (SELECT 1 FROM public.rh_recruitment_states WHERE process_id = p.id) THEN
      INSERT INTO public.rh_recruitment_states (organization_id, process_id, name, color, position, is_default)
      VALUES
        (p.organization_id, p.id, 'En proceso', 'sky', 0, true),
        (p.organization_id, p.id, 'Contratado', 'emerald', 1, false),
        (p.organization_id, p.id, 'Descartado', 'red', 2, false),
        (p.organization_id, p.id, 'Declinó', 'slate', 3, false);
    END IF;
  END LOOP;
END $$;

-- ---- Mapea el estado (enum) previo de cada candidato al nuevo estado ----
UPDATE public.rh_candidates c
SET state_id = s.id
FROM public.rh_recruitment_states s
WHERE s.process_id = c.process_id
  AND c.state_id IS NULL
  AND s.name = CASE c.status
    WHEN 'active'    THEN 'En proceso'
    WHEN 'hired'     THEN 'Contratado'
    WHEN 'rejected'  THEN 'Descartado'
    WHEN 'withdrawn' THEN 'Declinó'
  END;

-- =============================================================
-- Storage — bucket privado de CV (solo reclutadores de la org)
-- Ruta sugerida: {organization_id}/{candidate_id}/{archivo}
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cv', 'cv', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "CV recruiters select" ON storage.objects;
DROP POLICY IF EXISTS "CV recruiters insert" ON storage.objects;
DROP POLICY IF EXISTS "CV recruiters update" ON storage.objects;
DROP POLICY IF EXISTS "CV recruiters delete" ON storage.objects;

CREATE POLICY "CV recruiters select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cv' AND public.rh_is_recruiter(auth.uid()));
CREATE POLICY "CV recruiters insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cv' AND public.rh_is_recruiter(auth.uid()));
CREATE POLICY "CV recruiters update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cv' AND public.rh_is_recruiter(auth.uid()));
CREATE POLICY "CV recruiters delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cv' AND public.rh_is_recruiter(auth.uid()));
