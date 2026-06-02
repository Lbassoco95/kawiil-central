-- =============================================================
-- RH — Onboarding: conversión de candidato a colaborador y
-- checklist de bienvenida (plantilla por organización + instancia por
-- colaborador).
-- =============================================================

-- Vincula al candidato con el usuario creado al contratarlo.
ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS hired_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------- Plantilla de bienvenida (por organización) ----------------
CREATE TABLE IF NOT EXISTS public.rh_onboarding_template_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label           text NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_obtpl_org ON public.rh_onboarding_template_items(organization_id, position);

-- ---------------- Checklist por colaborador ----------------
CREATE TABLE IF NOT EXISTS public.rh_onboarding_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label           text NOT NULL,
  done            boolean NOT NULL DEFAULT false,
  done_by         uuid REFERENCES auth.users(id),
  done_at         timestamptz,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_obitems_user ON public.rh_onboarding_items(user_id, position);

ALTER TABLE public.rh_onboarding_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_onboarding_items ENABLE ROW LEVEL SECURITY;

-- ----- RLS plantilla: la org la lee; G4 la edita -----
DROP POLICY IF EXISTS "Org reads onboarding template" ON public.rh_onboarding_template_items;
CREATE POLICY "Org reads onboarding template" ON public.rh_onboarding_template_items
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "G4 manages onboarding template" ON public.rh_onboarding_template_items;
CREATE POLICY "G4 manages onboarding template" ON public.rh_onboarding_template_items
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- ----- RLS checklist: el dueño ve y marca lo suyo; G4 gestiona todo -----
DROP POLICY IF EXISTS "Owner sees own onboarding" ON public.rh_onboarding_items;
CREATE POLICY "Owner sees own onboarding" ON public.rh_onboarding_items
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner toggles own onboarding" ON public.rh_onboarding_items;
CREATE POLICY "Owner toggles own onboarding" ON public.rh_onboarding_items
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "G4 manages onboarding items" ON public.rh_onboarding_items;
CREATE POLICY "G4 manages onboarding items" ON public.rh_onboarding_items
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- ---- Seed de la plantilla de bienvenida para organizaciones existentes ----
DO $$
DECLARE o record;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    IF NOT EXISTS (SELECT 1 FROM public.rh_onboarding_template_items WHERE organization_id = o.id) THEN
      INSERT INTO public.rh_onboarding_template_items (organization_id, label, position) VALUES
        (o.id, 'Firmar contrato laboral', 0),
        (o.id, 'Entregar documentos del expediente', 1),
        (o.id, 'Alta en el IMSS', 2),
        (o.id, 'Crear correo corporativo y accesos', 3),
        (o.id, 'Asignar equipo de cómputo', 4),
        (o.id, 'Configurar herramientas de trabajo', 5),
        (o.id, 'Inducción y bienvenida con la célula', 6),
        (o.id, 'Reunión 1:1 con su líder', 7);
    END IF;
  END LOOP;
END $$;
