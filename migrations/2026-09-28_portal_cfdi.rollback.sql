-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260928140300_portal_cfdi.sql
-- DESTRUCTIVO para datos del portal: borra facturas cargadas/importadas, emisiones de prueba,
-- solicitudes de cancelación, cartas registradas y el registro/contraseñas de CSD del portal.
-- NO toca client_sat_certificates (tabla existente): los CSD cargados ahí se quedan.
-- Si hay datos que conservar, respalde antes: pg_dump -t 'public.portal_*'.
DROP TRIGGER IF EXISTS trg_portal_guard_emission_switch ON public.portal_client_settings;
DROP FUNCTION IF EXISTS public.portal_guard_emission_switch();
DROP FUNCTION IF EXISTS public.portal_basic_usage(uuid);
DROP FUNCTION IF EXISTS public.portal_csd_status(uuid);
DROP FUNCTION IF EXISTS public.portal_staff_resolve_cancel(uuid, text, text);
DROP FUNCTION IF EXISTS public.portal_cancel_request(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.portal_staff_register_instruction_letter(uuid, text, date, text);
DROP FUNCTION IF EXISTS public.portal_staff_set_emission(uuid, boolean);
DROP FUNCTION IF EXISTS public.portal_staff_import_moffin_cfdi(uuid, jsonb);
DROP FUNCTION IF EXISTS public.portal_set_category_suggestion(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.portal_staff_confirm_category(uuid[], uuid);
DROP FUNCTION IF EXISTS public.portal_dashboard(uuid, int, int);
DROP FUNCTION IF EXISTS public.portal_emission_dossier(uuid);
DROP VIEW IF EXISTS public.portal_cfdi_v;
DROP TABLE IF EXISTS public.portal_cancel_requests;
DROP TABLE IF EXISTS public.portal_emissions;
DROP TABLE IF EXISTS public.portal_csd_secrets;
DROP TABLE IF EXISTS public.portal_csd_registry;
DROP TABLE IF EXISTS public.portal_instruction_letters;
DROP TABLE IF EXISTS public.portal_cfdi;
DROP TABLE IF EXISTS public.portal_category_rules;
DROP TABLE IF EXISTS public.portal_expense_categories;
DROP FUNCTION IF EXISTS public.portal_cfdi_flags(text, text, numeric, text);
DROP FUNCTION IF EXISTS public.portal_cfdi_apply_rules();
-- El REVOKE ... FROM anon sobre client_sat_certificates se deja: anon nunca debió tener acceso.
