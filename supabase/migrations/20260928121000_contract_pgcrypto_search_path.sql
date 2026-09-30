-- =============================================================================
-- Contratos: exponer pgcrypto a las funciones que generan y validan tokens
-- =============================================================================

ALTER FUNCTION public.contract_hash_token(text)
  SET search_path = public, extensions;

ALTER FUNCTION public.start_contract_engagement(uuid, public.contract_package_kind)
  SET search_path = public, extensions;

ALTER FUNCTION public.contract_rotate_access_token(uuid)
  SET search_path = public, extensions;

NOTIFY pgrst, 'reload schema';
