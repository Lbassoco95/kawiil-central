-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929110000_portal_core.sql (correr AL FINAL).
-- DESTRUCTIVO para datos del portal: borra cuentas del portal (también sus usuarios de Auth),
-- membresías, ajustes, textos legales, aceptaciones y la bitácora del portal.
-- Por qué borra los usuarios de Auth del portal: sin portal_accounts ni el trigger que
-- bloquea perfiles, la policy existente "Users insert own profile" les permitiría crearse un
-- perfil de staff en cualquier organización. Un usuario del portal sin cuenta de portal es
-- un riesgo; por eso se elimina. Respalde antes si necesita la evidencia:
--   pg_dump -t 'public.portal_*' ...
-- Restaura handle_new_user a su versión de 20260308200900.
DELETE FROM auth.users WHERE id IN (SELECT user_id FROM public.portal_accounts);
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, organization_id, email, full_name)
  VALUES (
    NEW.id,
    'a0000000-0000-0000-0000-000000000001',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'en_formacion');

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_block_profiles ON public.profiles;
DROP TRIGGER IF EXISTS trg_portal_block_user_roles ON public.user_roles;
DROP FUNCTION IF EXISTS public.portal_block_staff_rows_for_portal_accounts();
DROP FUNCTION IF EXISTS public.portal_staff_accounts();
DROP FUNCTION IF EXISTS public.portal_staff_update_client_settings(uuid, uuid, int, int, boolean, boolean);
DROP FUNCTION IF EXISTS public.portal_staff_set_account(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.portal_staff_set_membership(uuid, text, text);
DROP FUNCTION IF EXISTS public.portal_staff_link_account(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.portal_activate_basic(text, text);
DROP FUNCTION IF EXISTS public.portal_log_access(uuid);
DROP FUNCTION IF EXISTS public.portal_accept_legal(text, uuid, text);
DROP FUNCTION IF EXISTS public.portal_me();
DROP FUNCTION IF EXISTS public.portal_current_legal(text);
DROP FUNCTION IF EXISTS public.portal_audit(text, uuid, text, text, jsonb, uuid);
DROP TABLE IF EXISTS public.portal_audit_log;
DROP FUNCTION IF EXISTS public.portal_audit_immutable();
DROP TABLE IF EXISTS public.portal_legal_acceptances;
DROP TABLE IF EXISTS public.portal_legal_documents;
DROP POLICY IF EXISTS portal_accounts_select_staff ON public.portal_accounts;
DROP TABLE IF EXISTS public.portal_client_settings;
DROP TABLE IF EXISTS public.portal_memberships;
DROP TABLE IF EXISTS public.portal_accounts;
DROP FUNCTION IF EXISTS public.portal_block_portal_account_for_staff();
DROP TABLE IF EXISTS public.portal_config;
DROP FUNCTION IF EXISTS public.portal_can_read_org(uuid);
DROP FUNCTION IF EXISTS public.portal_client_org_id(uuid);
DROP FUNCTION IF EXISTS public.portal_staff_assigned_to_client(uuid, uuid);
DROP FUNCTION IF EXISTS public.portal_my_tier();
DROP FUNCTION IF EXISTS public.portal_has_client_role(uuid, text[]);
DROP FUNCTION IF EXISTS public.portal_can_read_client(uuid);
DROP FUNCTION IF EXISTS public.portal_my_client_ids();
DROP FUNCTION IF EXISTS public.portal_staff_in_client_org(uuid, uuid);
DROP FUNCTION IF EXISTS public.portal_is_staff_admin(uuid);
DROP FUNCTION IF EXISTS public.portal_is_staff(uuid);
DROP FUNCTION IF EXISTS public.portal_is_portal_user(uuid);
DROP FUNCTION IF EXISTS public.portal_inherit_client_org();
