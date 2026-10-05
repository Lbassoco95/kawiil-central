-- =================================================================
-- Portal del cliente — B2 (cierre): ninguna función del portal ejecutable por
-- PUBLIC o anon sin justificación.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-29
-- Rollback (a mano): migrations/2026-09-29_portal_function_grants.rollback.sql
--
-- Supabase da EXECUTE a anon por omisión en el esquema public. Quedan para anon, a
-- propósito, solo cuatro:
--   portal_pre_request()        PostgREST la corre en TODA petición (también anónima).
--   portal_route_guard_status() diagnóstico público del cerco (solo booleanos y un conteo).
--   portal_caller_is_portal()   la usan las políticas restrictivas, que también se evalúan para anon.
--   portal_current_legal(text)  texto legal vigente, que se muestra en el registro antes de iniciar sesión.
-- A todas las demás se les quita PUBLIC y anon. Las de trigger no necesitan EXECUTE
-- para dispararse; las auxiliares siguen disponibles para authenticated y service_role.
-- Solo cambia permisos; no toca datos.
-- =================================================================
-- Funciones de trigger (no se pueden invocar fuera de un trigger; se retira igual el permiso).
REVOKE EXECUTE ON FUNCTION public.portal_after_message() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_audit_immutable() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_block_direct_receipt_writes() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_block_portal_account_for_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_block_staff_rows_for_portal_accounts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_cfdi_apply_rules() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_client_settings_retention_guard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_documents_force_pending() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_documents_guard_publish() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_dropbox_mapping_once() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_guard_emission_switch() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_inherit_client_org() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_inherit_thread_scope() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_require_route_guard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_retention_elections_append_only() FROM PUBLIC, anon;

-- Auxiliares: fuera PUBLIC y anon; se conservan para las sesiones y el servidor.
REVOKE EXECUTE ON FUNCTION public.portal_cfdi_flags(text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_cfdi_flags(text, text, numeric, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.portal_is_forbidden_filename(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_is_forbidden_filename(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.portal_retention_allowed(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_retention_allowed(int) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.portal_table_allowlist() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_table_allowlist() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.portal_ticket_deadline(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_ticket_deadline(uuid, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.portal_ticket_visible_status(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_ticket_visible_status(text, timestamptz) TO authenticated, service_role;
