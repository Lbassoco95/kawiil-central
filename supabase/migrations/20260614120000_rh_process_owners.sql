-- =============================================================
-- RH — Responsables de la contratación (por vacante)
-- A diferencia del Entrevistador (solo evalúa), el Responsable GESTIONA su
-- vacante: mueve candidatos, cambia fases/estados, califica, envía correos
-- e importa — como un admin, pero acotado a las vacantes que se le asignan.
-- La asignación la hace un reclutador/G4 (rh_is_recruiter).
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rh_process_owners (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  process_id      uuid NOT NULL REFERENCES public.rh_recruitment_processes(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (process_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rh_owner_user ON public.rh_process_owners(user_id);

-- ---------------- Helpers ----------------
CREATE OR REPLACE FUNCTION public.rh_is_process_owner(_user_id uuid, _process_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rh_process_owners WHERE user_id = _user_id AND process_id = _process_id)
$$;

CREATE OR REPLACE FUNCTION public.rh_is_any_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rh_process_owners WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.rh_owns_candidate(_user_id uuid, _candidate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rh_candidates c
    JOIN public.rh_process_owners o ON o.process_id = c.process_id
    WHERE c.id = _candidate_id AND o.user_id = _user_id
  )
$$;

ALTER TABLE public.rh_process_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recruiters manage owners" ON public.rh_process_owners;
CREATE POLICY "Recruiters manage owners" ON public.rh_process_owners
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));

DROP POLICY IF EXISTS "Owner sees own ownership" ON public.rh_process_owners;
CREATE POLICY "Owner sees own ownership" ON public.rh_process_owners
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------- Gestión por el responsable (acotada a su vacante) ----------------
-- Proceso: leer y actualizar (estado de la vacante).
DROP POLICY IF EXISTS "Owner reads process" ON public.rh_recruitment_processes;
CREATE POLICY "Owner reads process" ON public.rh_recruitment_processes
  FOR SELECT TO authenticated USING (public.rh_is_process_owner(auth.uid(), id));
DROP POLICY IF EXISTS "Owner updates process" ON public.rh_recruitment_processes;
CREATE POLICY "Owner updates process" ON public.rh_recruitment_processes
  FOR UPDATE TO authenticated
  USING (public.rh_is_process_owner(auth.uid(), id))
  WITH CHECK (public.rh_is_process_owner(auth.uid(), id));

-- Fases, estados y criterios: gestión completa.
DROP POLICY IF EXISTS "Owner manages stages" ON public.rh_recruitment_stages;
CREATE POLICY "Owner manages stages" ON public.rh_recruitment_stages
  FOR ALL TO authenticated
  USING (public.rh_is_process_owner(auth.uid(), process_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_process_owner(auth.uid(), process_id));

DROP POLICY IF EXISTS "Owner manages states" ON public.rh_recruitment_states;
CREATE POLICY "Owner manages states" ON public.rh_recruitment_states
  FOR ALL TO authenticated
  USING (public.rh_is_process_owner(auth.uid(), process_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_process_owner(auth.uid(), process_id));

DROP POLICY IF EXISTS "Owner manages criteria" ON public.rh_recruitment_criteria;
CREATE POLICY "Owner manages criteria" ON public.rh_recruitment_criteria
  FOR ALL TO authenticated
  USING (public.rh_is_process_owner(auth.uid(), process_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_process_owner(auth.uid(), process_id));

-- Candidatos: gestión completa de los de su vacante.
DROP POLICY IF EXISTS "Owner manages candidates" ON public.rh_candidates;
CREATE POLICY "Owner manages candidates" ON public.rh_candidates
  FOR ALL TO authenticated
  USING (public.rh_is_process_owner(auth.uid(), process_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_process_owner(auth.uid(), process_id));

-- Bitácora y calificaciones de esos candidatos.
DROP POLICY IF EXISTS "Owner manages candidate activities" ON public.rh_candidate_activities;
CREATE POLICY "Owner manages candidate activities" ON public.rh_candidate_activities
  FOR ALL TO authenticated
  USING (public.rh_owns_candidate(auth.uid(), candidate_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_owns_candidate(auth.uid(), candidate_id));

DROP POLICY IF EXISTS "Owner manages scores" ON public.rh_candidate_scores;
CREATE POLICY "Owner manages scores" ON public.rh_candidate_scores
  FOR ALL TO authenticated
  USING (public.rh_owns_candidate(auth.uid(), candidate_id))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_owns_candidate(auth.uid(), candidate_id));

-- Plantillas de correo (de la org): los responsables pueden leerlas para enviar.
DROP POLICY IF EXISTS "Owners read email templates" ON public.rh_email_templates;
CREATE POLICY "Owners read email templates" ON public.rh_email_templates
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_any_owner(auth.uid()));

-- CV: los responsables (de cualquier vacante) leen/suben CV.
DROP POLICY IF EXISTS "CV owners select" ON storage.objects;
CREATE POLICY "CV owners select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cv' AND public.rh_is_any_owner(auth.uid()));
DROP POLICY IF EXISTS "CV owners insert" ON storage.objects;
CREATE POLICY "CV owners insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cv' AND public.rh_is_any_owner(auth.uid()));
DROP POLICY IF EXISTS "CV owners update" ON storage.objects;
CREATE POLICY "CV owners update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cv' AND public.rh_is_any_owner(auth.uid()));
