-- =============================================================
-- RH — Entrega 5: reclutamiento y selección (núcleo)
-- Vacantes/procesos con fases, candidatos por fase, correos
-- (desde Outlook del reclutador) y bitácora de seguimiento.
-- Acceso por "permiso de reclutador" (user_module_permissions:'reclutamiento')
-- o por grado G4 (transformador).
-- =============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_process_status') THEN
    CREATE TYPE public.rh_process_status AS ENUM ('open', 'paused', 'closed', 'filled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_candidate_status') THEN
    CREATE TYPE public.rh_candidate_status AS ENUM ('active', 'hired', 'rejected', 'withdrawn');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_candidate_activity_type') THEN
    CREATE TYPE public.rh_candidate_activity_type AS ENUM ('note', 'email', 'stage_change', 'status_change', 'interview');
  END IF;
END $$;

-- ¿El usuario puede gestionar reclutamiento? (permiso activo o G4)
CREATE OR REPLACE FUNCTION public.rh_is_recruiter(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'transformador')
    OR EXISTS (
      SELECT 1 FROM public.user_module_permissions ump
      WHERE ump.user_id = _user_id AND ump.module_key = 'reclutamiento' AND ump.enabled = true
    )
$$;

-- ---------------- Procesos / vacantes ----------------
CREATE TABLE IF NOT EXISTS public.rh_recruitment_processes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  area            text,
  celula_id       uuid REFERENCES public.celulas(id) ON DELETE SET NULL,
  description     text,
  status          public.rh_process_status NOT NULL DEFAULT 'open',
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_proc_org ON public.rh_recruitment_processes(organization_id, status);

-- ---------------- Fases del proceso ----------------
CREATE TABLE IF NOT EXISTS public.rh_recruitment_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  process_id      uuid NOT NULL REFERENCES public.rh_recruitment_processes(id) ON DELETE CASCADE,
  name            text NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_stage_proc ON public.rh_recruitment_stages(process_id, position);

-- ---------------- Candidatos ----------------
CREATE TABLE IF NOT EXISTS public.rh_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  process_id      uuid NOT NULL REFERENCES public.rh_recruitment_processes(id) ON DELETE CASCADE,
  stage_id        uuid REFERENCES public.rh_recruitment_stages(id) ON DELETE SET NULL,
  full_name       text NOT NULL,
  email           text,
  phone           text,
  source          text,
  resume_url      text,
  rating          integer NOT NULL DEFAULT 0,
  status          public.rh_candidate_status NOT NULL DEFAULT 'active',
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_cand_proc ON public.rh_candidates(process_id, stage_id);

-- ---------------- Bitácora del candidato ----------------
CREATE TABLE IF NOT EXISTS public.rh_candidate_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id    uuid NOT NULL REFERENCES public.rh_candidates(id) ON DELETE CASCADE,
  activity_type   public.rh_candidate_activity_type NOT NULL,
  content         text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_cand_act ON public.rh_candidate_activities(candidate_id, created_at DESC);

-- updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_rh_proc ON public.rh_recruitment_processes;
CREATE TRIGGER set_updated_at_rh_proc BEFORE UPDATE ON public.rh_recruitment_processes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at_rh_cand ON public.rh_candidates;
CREATE TRIGGER set_updated_at_rh_cand BEFORE UPDATE ON public.rh_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- RLS — solo reclutadores (permiso o G4) de la misma organización
-- =============================================================
ALTER TABLE public.rh_recruitment_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_recruitment_stages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_candidates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_candidate_activities  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rh_recruitment_processes', 'rh_recruitment_stages', 'rh_candidates', 'rh_candidate_activities'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Recruiters manage %1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "Recruiters manage %1$s" ON public.%1$s FOR ALL TO authenticated '
      || 'USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid())) '
      || 'WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));',
      t
    );
  END LOOP;
END $$;
