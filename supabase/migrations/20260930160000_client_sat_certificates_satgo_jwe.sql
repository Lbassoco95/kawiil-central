-- SATgo e.firma: guardar JWE (RSA-OAEP-256 + A256GCM) de .key y contraseña
-- para POST /api/v2/Consultar/csffiel|/ocfiel con header X-Fiel-Encryption: JWE.
-- Docs: https://sat-go.com/cifrar-efirma

ALTER TABLE public.client_sat_certificates
  ADD COLUMN IF NOT EXISTS satgo_key_jwe text,
  ADD COLUMN IF NOT EXISTS satgo_password_jwe text,
  ADD COLUMN IF NOT EXISTS satgo_jwe_kid text,
  ADD COLUMN IF NOT EXISTS satgo_jwe_updated_at timestamptz;

COMMENT ON COLUMN public.client_sat_certificates.satgo_key_jwe IS
  'JWE compacto (RSA-OAEP-256+A256GCM) del .key crudo para SATgo; solo desencriptable por SatGo.';
COMMENT ON COLUMN public.client_sat_certificates.satgo_password_jwe IS
  'JWE compacto de la contraseña de la e.firma para SATgo.';
COMMENT ON COLUMN public.client_sat_certificates.satgo_jwe_kid IS
  'kid de la llave pública SATgo usada al cifrar (fiel-encryption-key).';

CREATE INDEX IF NOT EXISTS idx_client_sat_certificates_satgo_jwe_ready
  ON public.client_sat_certificates (client_id)
  WHERE cert_type = 'fiel'
    AND satgo_key_jwe IS NOT NULL
    AND satgo_password_jwe IS NOT NULL;
