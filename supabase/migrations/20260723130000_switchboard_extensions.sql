-- =============================================================
-- Conmutador — Extensiones por persona (softphone SIP)
-- Modelo: 1 DID público + N extensiones internas. Cada colaborador tiene una
-- extensión que resuelve a un endpoint SIP (credencial de Telnyx) al que registra
-- su softphone. El endpoint es INTERNO: se usa para el SIP REFER y NUNCA se
-- expone al llamante.
--
-- No duplica el directorio: el nombre/teléfono vive en public.profiles; aquí solo
-- el mapeo extensión → user_id → endpoint.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.switchboard_extensions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  extension       text NOT NULL,          -- p. ej. "101" (dígitos)
  sip_endpoint    text,                   -- p. ej. sip:kawiiler101@sip.telnyx.com (interno)
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, extension),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_switchboard_extensions_org
  ON public.switchboard_extensions(organization_id);

COMMENT ON TABLE public.switchboard_extensions IS
  'Extensiones del Conmutador: mapeo extensión → colaborador → endpoint SIP (softphone). El endpoint es interno para el SIP REFER; nunca se expone al llamante.';

DROP TRIGGER IF EXISTS set_updated_at_switchboard_extensions ON public.switchboard_extensions;
CREATE TRIGGER set_updated_at_switchboard_extensions
  BEFORE UPDATE ON public.switchboard_extensions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- Vista de directorio: extensión + nombre (para la UI y para resolver por
-- nombre en sw-extension-target). security_invoker=true respeta la RLS.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_switchboard_directory
WITH (security_invoker = true) AS
SELECT
  e.organization_id,
  e.extension,
  e.user_id,
  p.full_name AS nombre,
  e.sip_endpoint,
  e.is_active
FROM public.switchboard_extensions e
LEFT JOIN public.profiles p ON p.user_id = e.user_id;

COMMENT ON VIEW public.v_switchboard_directory IS
  'Directorio de extensiones del Conmutador (extensión + nombre + endpoint). security_invoker=true.';

-- =============================================================
-- RLS: la org lee el directorio (uso interno); solo G4 administra.
-- =============================================================
ALTER TABLE public.switchboard_extensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org reads switchboard_extensions" ON public.switchboard_extensions;
CREATE POLICY "Org reads switchboard_extensions" ON public.switchboard_extensions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "G4 manages switchboard_extensions" ON public.switchboard_extensions;
CREATE POLICY "G4 manages switchboard_extensions" ON public.switchboard_extensions
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  );
