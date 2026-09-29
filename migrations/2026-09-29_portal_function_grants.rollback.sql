-- 2026-09-29 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929120700_portal_function_grants.sql.
-- Devuelve EXECUTE a anon (como lo deja Supabase por omisión) en las mismas funciones.
GRANT EXECUTE ON FUNCTION public.portal_after_message() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_audit_immutable() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_block_direct_receipt_writes() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_block_portal_account_for_staff() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_block_staff_rows_for_portal_accounts() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_cfdi_apply_rules() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_client_settings_retention_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_documents_force_pending() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_documents_guard_publish() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_dropbox_mapping_once() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_guard_emission_switch() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_inherit_client_org() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_inherit_thread_scope() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_require_route_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_retention_elections_append_only() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_cfdi_flags(text, text, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_is_forbidden_filename(text) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_retention_allowed(int) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_table_allowlist() TO anon;
GRANT EXECUTE ON FUNCTION public.portal_ticket_deadline(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_ticket_visible_status(text, timestamptz) TO anon;
