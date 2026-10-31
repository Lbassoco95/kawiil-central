-- =============================================================
-- RH — Registro inmutable de consentimientos (LFPDPPP)
-- Un renglón por postulación: estado de cada checkbox, versión del
-- aviso de privacidad y timestamp UTC. Solo se inserta con service
-- role (edge function recruit-apply). Los reclutadores solo leen;
-- UPDATE/DELETE están bloqueados por trigger.
-- candidate_id NO tiene FK a propósito: la evidencia del consentimiento
-- debe sobrevivir si el expediente se cancela por derechos ARCO.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rh_candidate_consents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id            uuid NOT NULL,
  process_id              uuid,
  notice_version          text NOT NULL,
  primary_accepted        boolean NOT NULL,
  talent_pool_accepted    boolean NOT NULL DEFAULT false,
  consented_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rh_consents_primary_required CHECK (primary_accepted = true)
);
CREATE INDEX IF NOT EXISTS idx_rh_consents_candidate ON public.rh_candidate_consents(candidate_id);
CREATE INDEX IF NOT EXISTS idx_rh_consents_org ON public.rh_candidate_consents(organization_id, consented_at DESC);

CREATE OR REPLACE FUNCTION public.rh_consents_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rh_candidate_consents es un registro inmutable (% no permitido)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS rh_consents_no_update ON public.rh_candidate_consents;
CREATE TRIGGER rh_consents_no_update BEFORE UPDATE OR DELETE ON public.rh_candidate_consents
  FOR EACH ROW EXECUTE FUNCTION public.rh_consents_immutable();

ALTER TABLE public.rh_candidate_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recruiters read rh_candidate_consents" ON public.rh_candidate_consents;
CREATE POLICY "Recruiters read rh_candidate_consents" ON public.rh_candidate_consents
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));
-- Sin políticas de INSERT/UPDATE/DELETE: solo service role escribe.
