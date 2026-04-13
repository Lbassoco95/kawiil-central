-- Idempotente: crea la tabla si en el proyecto remoto no se aplicó 20260413120000_moffin_client_sat_ciec.sql.
CREATE TABLE IF NOT EXISTS public.moffin_client_sat_ciec (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ciec_ciphertext text NOT NULL,
  moffin_profile_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(client_id)
);

CREATE INDEX IF NOT EXISTS idx_moffin_client_sat_ciec_org ON public.moffin_client_sat_ciec (organization_id);

ALTER TABLE public.moffin_client_sat_ciec ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.moffin_client_sat_ciec IS 'CIEC SAT cifrada por cliente (AES-GCM con MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET en Edge). moffin_profile_id se invalida al cambiar CIEC. Usar función moffin-sat-ciec.';
