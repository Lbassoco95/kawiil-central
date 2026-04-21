-- Tabla generica de certificados SAT por cliente: 1 FIEL (e.firma) + N CSDs (sellos digitales).
-- Sustituye conceptualmente a moffin_client_fiel; este queda como VIEW de compatibilidad
-- para que las Edge Functions moffin-fiel y moffin-query sigan funcionando sin cambios.
--
-- El cifrado en reposo de cert_ciphertext / key_ciphertext usa AES-GCM con MOFFIN_FIEL_SECRET
-- (>=32 chars) ya configurado en Edge Functions Secrets. Mismo helper:
-- supabase/functions/_shared/moffinFielCrypto.ts.
--
-- Acceso: RLS habilitada SIN policies. Solo Edge Functions con service_role leen/escriben
-- via la nueva funcion client-sat-certificates.

CREATE TABLE IF NOT EXISTS public.client_sat_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cert_type text NOT NULL CHECK (cert_type IN ('fiel','csd_sello')),
  label text,
  cert_ciphertext text NOT NULL,
  key_ciphertext text NOT NULL,
  cert_serial text,
  cert_subject_rfc text,
  cert_not_before timestamptz,
  cert_not_after timestamptz,
  cert_fingerprint_sha256 text,
  last_reminder_bucket text,
  last_reminder_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 1 FIEL por cliente; N CSD permitidos (uno por serie).
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_sat_certificates_fiel
  ON public.client_sat_certificates (client_id)
  WHERE cert_type = 'fiel';

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_sat_certificates_serial
  ON public.client_sat_certificates (client_id, cert_serial)
  WHERE cert_serial IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_sat_certificates_org
  ON public.client_sat_certificates (organization_id);

CREATE INDEX IF NOT EXISTS idx_client_sat_certificates_not_after
  ON public.client_sat_certificates (cert_not_after);

ALTER TABLE public.client_sat_certificates ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.client_sat_certificates IS
  'Certificados SAT por cliente (FIEL y CSDs). Cifrado AES-GCM con MOFFIN_FIEL_SECRET. Acceso solo via Edge client-sat-certificates.';

-- ---------------------------------------------------------------------------
-- Migracion de datos existentes: moffin_client_fiel -> client_sat_certificates
-- (solo corre si moffin_client_fiel sigue siendo TABLE; tras este script pasa a VIEW).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'moffin_client_fiel'
      AND table_type = 'BASE TABLE'
  ) THEN
    INSERT INTO public.client_sat_certificates
      (organization_id, client_id, cert_type, cert_ciphertext, key_ciphertext,
       cert_fingerprint_sha256, updated_at, updated_by)
    SELECT m.organization_id, m.client_id, 'fiel', m.cert_ciphertext, m.key_ciphertext,
           m.cert_fingerprint_sha256, m.updated_at, m.updated_by
    FROM public.moffin_client_fiel m
    WHERE NOT EXISTS (
      SELECT 1 FROM public.client_sat_certificates c
      WHERE c.client_id = m.client_id AND c.cert_type = 'fiel'
    );

    -- Reemplazar la tabla por una VIEW de compatibilidad.
    DROP TABLE public.moffin_client_fiel CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- VIEW de compatibilidad: moffin_client_fiel filtra cert_type='fiel'.
-- Triggers INSTEAD OF para INSERT/UPDATE/DELETE permiten que las Edge actuales
-- (moffin-fiel save/delete y moffin-query lectura) sigan funcionando sin cambios.
-- ---------------------------------------------------------------------------
-- security_invoker=true: la VIEW respeta RLS del usuario que consulta,
-- evitando el hallazgo "SECURITY DEFINER View" del Supabase Advisor.
CREATE OR REPLACE VIEW public.moffin_client_fiel
WITH (security_invoker = true) AS
  SELECT
    id,
    organization_id,
    client_id,
    cert_ciphertext,
    key_ciphertext,
    cert_fingerprint_sha256,
    updated_at,
    updated_by
  FROM public.client_sat_certificates
  WHERE cert_type = 'fiel';

COMMENT ON VIEW public.moffin_client_fiel IS
  'VIEW de compatibilidad sobre client_sat_certificates (cert_type=fiel). Mantener mientras moffin-fiel y moffin-query no migren a la tabla nueva.';

CREATE OR REPLACE FUNCTION public.moffin_client_fiel_compat_iud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.client_sat_certificates (
      id, organization_id, client_id, cert_type,
      cert_ciphertext, key_ciphertext, cert_fingerprint_sha256,
      updated_at, updated_by
    ) VALUES (
      COALESCE(NEW.id, gen_random_uuid()),
      NEW.organization_id,
      NEW.client_id,
      'fiel',
      NEW.cert_ciphertext,
      NEW.key_ciphertext,
      NEW.cert_fingerprint_sha256,
      COALESCE(NEW.updated_at, now()),
      NEW.updated_by
    )
    ON CONFLICT (client_id) WHERE cert_type = 'fiel'
    DO UPDATE SET
      cert_ciphertext = EXCLUDED.cert_ciphertext,
      key_ciphertext = EXCLUDED.key_ciphertext,
      cert_fingerprint_sha256 = EXCLUDED.cert_fingerprint_sha256,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by,
      last_reminder_bucket = NULL,
      last_reminder_at = NULL;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.client_sat_certificates
       SET cert_ciphertext = NEW.cert_ciphertext,
           key_ciphertext = NEW.key_ciphertext,
           cert_fingerprint_sha256 = NEW.cert_fingerprint_sha256,
           updated_at = COALESCE(NEW.updated_at, now()),
           updated_by = NEW.updated_by
     WHERE client_id = OLD.client_id AND cert_type = 'fiel';
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.client_sat_certificates
     WHERE client_id = OLD.client_id AND cert_type = 'fiel';
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS moffin_client_fiel_compat_ins ON public.moffin_client_fiel;
DROP TRIGGER IF EXISTS moffin_client_fiel_compat_upd ON public.moffin_client_fiel;
DROP TRIGGER IF EXISTS moffin_client_fiel_compat_del ON public.moffin_client_fiel;

CREATE TRIGGER moffin_client_fiel_compat_ins
  INSTEAD OF INSERT ON public.moffin_client_fiel
  FOR EACH ROW EXECUTE FUNCTION public.moffin_client_fiel_compat_iud();

CREATE TRIGGER moffin_client_fiel_compat_upd
  INSTEAD OF UPDATE ON public.moffin_client_fiel
  FOR EACH ROW EXECUTE FUNCTION public.moffin_client_fiel_compat_iud();

CREATE TRIGGER moffin_client_fiel_compat_del
  INSTEAD OF DELETE ON public.moffin_client_fiel
  FOR EACH ROW EXECUTE FUNCTION public.moffin_client_fiel_compat_iud();

REVOKE ALL ON FUNCTION public.moffin_client_fiel_compat_iud() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moffin_client_fiel_compat_iud() TO postgres, service_role;

-- La VIEW se accede solo via service_role (igual que la tabla original); no se otorgan grants extra.
REVOKE ALL ON public.moffin_client_fiel FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moffin_client_fiel TO service_role;
