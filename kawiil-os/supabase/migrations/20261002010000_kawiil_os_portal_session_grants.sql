-- Grants para service_role (Edge portal-api) + sesión portal_me adaptada a Kawiil OS.
-- Sin esto, buildCtx no puede leer portal_accounts (isPortal=false → 403 en tablero/facturas)
-- y sesion.actual falla porque no existe portal_me en el esquema OS.

BEGIN;

-- Lectura/escritura que usan las Edge con service_role (cuenta, bitácora, espejo).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Lecturas del JWT del cliente (RLS aplica encima).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- Asegura funciones de rol ejecutables.
GRANT EXECUTE ON FUNCTION public.portal_has_company_role(uuid, public.portal_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_staff_has_company_access(uuid, text) TO authenticated, service_role;

-- Textos legales del seed demo: publicados para que portal_me los vea.
UPDATE public.portal_legal_documents
   SET published_at = COALESCE(published_at, now())
 WHERE published_at IS NULL
   AND kind IN ('aviso_privacidad', 'terminos');

-- Estado de sesión para el front (espejo OS: portal_companies, no clients).
CREATE OR REPLACE FUNCTION public.portal_me()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acc public.portal_accounts;
  v_pending jsonb;
  v_clients jsonb;
  v_tier text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sin sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_acc FROM public.portal_accounts WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_portal_account', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', d.kind, 'version', d.version, 'title', d.title
         )), '[]'::jsonb)
    INTO v_pending
    FROM public.portal_legal_documents d
   WHERE d.kind IN ('aviso_privacidad', 'terminos')
     AND d.published_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.portal_legal_acceptances a
        WHERE a.user_id = v_uid AND a.document_id = d.id
     );

  IF v_acc.status = 'activa' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'client_id', c.id,
             'client_name', c.name,
             'rfc', c.rfc,
             'role', m.role,
             'emission_enabled', COALESCE(s.emission_enabled, false),
             'origin', 'kawiil',
             'tickets_enabled', COALESCE(c.tickets_enabled, false)
           ) ORDER BY c.name), '[]'::jsonb)
      INTO v_clients
      FROM public.portal_memberships m
      JOIN public.portal_companies c ON c.id = m.client_id
      LEFT JOIN public.portal_client_settings s ON s.client_id = c.id
     WHERE m.user_id = v_uid AND m.active IS TRUE;

    SELECT c.tier::text INTO v_tier
      FROM public.portal_memberships m
      JOIN public.portal_companies c ON c.id = m.client_id
     WHERE m.user_id = v_uid AND m.active IS TRUE
     ORDER BY CASE c.tier WHEN 'premier' THEN 0 ELSE 1 END
     LIMIT 1;
  ELSE
    v_clients := '[]'::jsonb;
    v_tier := NULL;
  END IF;

  RETURN jsonb_build_object(
    'is_portal_account', true,
    'user_id', v_acc.user_id,
    'email', v_acc.email,
    'full_name', v_acc.full_name,
    'status', v_acc.status,
    'tier', v_tier,
    'clients', COALESCE(v_clients, '[]'::jsonb),
    'pending_legal', COALESCE(v_pending, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_me() TO authenticated, service_role;

-- Bitácora mínima de acceso (no bloquea el guion si falla la cola de outbox).
CREATE OR REPLACE FUNCTION public.portal_log_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.portal_audit('acceso', NULL, 'portal_accounts', auth.uid()::text, '{}'::jsonb, auth.uid());
EXCEPTION WHEN undefined_function OR undefined_table THEN
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_log_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_log_access() TO authenticated, service_role;

COMMIT;
