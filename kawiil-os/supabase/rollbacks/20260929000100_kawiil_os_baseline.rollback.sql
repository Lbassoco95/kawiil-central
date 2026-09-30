BEGIN;

-- Primero tablas (y sus policies que dependen de las funciones auxiliares).
DROP TABLE IF EXISTS public.portal_system_outbox CASCADE;
DROP TABLE IF EXISTS public.portal_system_nonces CASCADE;
DROP TABLE IF EXISTS public.portal_survey_responses CASCADE;
DROP TABLE IF EXISTS public.portal_survey_participation CASCADE;
DROP TABLE IF EXISTS public.portal_survey_campaigns CASCADE;
DROP TABLE IF EXISTS public.portal_payroll_periods CASCADE;
DROP TABLE IF EXISTS public.portal_hr_documents CASCADE;
DROP TABLE IF EXISTS public.portal_hr_absences CASCADE;
DROP TABLE IF EXISTS public.portal_hr_attendance_changes CASCADE;
DROP TABLE IF EXISTS public.portal_hr_attendance CASCADE;
DROP TABLE IF EXISTS public.portal_employees CASCADE;
DROP TABLE IF EXISTS public.portal_message_attachments CASCADE;
DROP TABLE IF EXISTS public.portal_messages CASCADE;
DROP TABLE IF EXISTS public.portal_threads CASCADE;
DROP TABLE IF EXISTS public.portal_documents CASCADE;
DROP TABLE IF EXISTS public.portal_tickets CASCADE;
DROP TABLE IF EXISTS public.portal_merchants CASCADE;
DROP TABLE IF EXISTS public.portal_payment_links CASCADE;
DROP TABLE IF EXISTS public.portal_cfdi_concepts CASCADE;
DROP TABLE IF EXISTS public.portal_cfdi_tax_lines CASCADE;
DROP TABLE IF EXISTS public.portal_cfdi CASCADE;
DROP TABLE IF EXISTS public.portal_audit_log CASCADE;
DROP TABLE IF EXISTS public.portal_legal_acceptances CASCADE;
DROP TABLE IF EXISTS public.portal_legal_documents CASCADE;
DROP TABLE IF EXISTS public.portal_tax_profiles CASCADE;
DROP TABLE IF EXISTS public.portal_client_settings CASCADE;
DROP TABLE IF EXISTS public.portal_staff_grants CASCADE;
DROP TABLE IF EXISTS public.portal_memberships CASCADE;
DROP TABLE IF EXISTS public.portal_accounts CASCADE;
DROP TABLE IF EXISTS public.portal_companies CASCADE;

DROP FUNCTION IF EXISTS public.portal_audit(text, uuid, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.portal_is_employee(uuid, uuid);
DROP FUNCTION IF EXISTS public.portal_staff_has_company_access(uuid, text);
DROP FUNCTION IF EXISTS public.portal_has_company_role(uuid, public.portal_role[]);

DROP TYPE IF EXISTS public.portal_tier;
DROP TYPE IF EXISTS public.portal_role;

DELETE FROM storage.objects WHERE bucket_id IN ('portal','portal-rh','portal-tickets');
DELETE FROM storage.buckets WHERE id IN ('portal','portal-rh','portal-tickets');

COMMIT;
