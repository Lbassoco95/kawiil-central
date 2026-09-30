-- Allow Edge (service_role) to read SATgo API key from Vault when Edge Secrets
-- cannot be set via CLI (no Management API token). Prefer Edge Secrets when available.

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
  IF secret_name NOT IN ('satgo_api_key', 'satgo_access_token') THEN
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
  'Lee secretos allowlisted desde Vault para Edge (service_role). Preferir Edge Secrets SATGO_API_KEY cuando sea posible.';
