-- Allow Edge to read OS mirror HMAC secrets from Vault when Edge Secrets API is blocked.
CREATE OR REPLACE FUNCTION public.kawiil_vault_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v text;
BEGIN
  IF secret_name IS NULL OR length(trim(secret_name)) = 0 THEN
    RETURN NULL;
  END IF;
  IF secret_name NOT IN (
    'satgo_api_key',
    'satgo_access_token',
    'central_to_os_signing_secret',
    'kawiil_os_system_api_url'
  ) THEN
    RAISE EXCEPTION 'secret_not_allowed';
  END IF;
  SELECT decrypted_secret INTO v
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.kawiil_vault_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kawiil_vault_secret(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kawiil_vault_secret(text) TO service_role;

COMMENT ON FUNCTION public.kawiil_vault_secret(text) IS
  'Lee secretos allowlisted desde Vault para Edge (service_role). Incluye mirror OS HMAC cuando Edge Secrets no se pueden setear.';
