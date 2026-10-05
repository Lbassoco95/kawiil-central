-- Rollback Corte 3 espejo fiscal. Destructivo solo para tablas/columnas del espejo.

BEGIN;

DROP VIEW IF EXISTS public.portal_cfdi_v;

DROP TABLE IF EXISTS public.portal_system_inbox CASCADE;
DROP TABLE IF EXISTS public.portal_sat_notifications CASCADE;
DROP TABLE IF EXISTS public.portal_fiscal_alerts CASCADE;
DROP TABLE IF EXISTS public.portal_fiscal_summaries CASCADE;

DROP INDEX IF EXISTS public.portal_cfdi_client_external_ref_uidx;

ALTER TABLE public.portal_cfdi
  DROP COLUMN IF EXISTS external_ref,
  DROP COLUMN IF EXISTS flags,
  DROP COLUMN IF EXISTS category_name,
  DROP COLUMN IF EXISTS category_status;

COMMIT;
