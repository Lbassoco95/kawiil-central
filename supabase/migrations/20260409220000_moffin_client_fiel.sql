-- Material FIEL (.cer / .key) cifrado por cliente para consultas Moffin sat_rfc (constancia / opinión).
-- Solo la función Edge con service role lee/escribe; sin políticas RLS para usuarios finales.
CREATE TABLE public.moffin_client_fiel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cert_ciphertext text NOT NULL,
  key_ciphertext text NOT NULL,
  cert_fingerprint_sha256 text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(client_id)
);

CREATE INDEX idx_moffin_client_fiel_org ON public.moffin_client_fiel (organization_id);

ALTER TABLE public.moffin_client_fiel ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.moffin_client_fiel IS 'FIEL SAT cifrada por cliente (AES-GCM con MOFFIN_FIEL_SECRET en Edge). Sin SELECT para usuarios; usar función moffin-fiel.';
