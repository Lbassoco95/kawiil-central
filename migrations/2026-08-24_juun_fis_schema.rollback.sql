-- =================================================================
-- ROLLBACK de supabase/migrations/20260824220000_juun_fis_schema.sql
-- Proyecto: qppfampapbxdgednkofc  ·  Fecha: 2026-08-24  ·  Módulo: Ju'un
--
-- El pipeline del repo (supabase db push --include-all) es forward-only: este
-- script NO se ejecuta solo. Se aplica a mano en el SQL editor si hay que
-- deshacer el Bloque 1.
--
-- Idempotente y en orden inverso al script principal.
--
-- ⚠️ DESTRUCTIVO: borra perfiles fiscales, tickets, intentos y CFDI del
-- módulo. Los archivos en el bucket `juun` NO se tocan aquí (ver
-- 2026-08-24_juun_storage_bucket.rollback.sql).
-- =================================================================

-- 1. Triggers que derivan organization_id
DROP TRIGGER IF EXISTS trg_fis_cfdi_inherit_org ON public.fis_cfdi;
DROP TRIGGER IF EXISTS trg_fis_attempts_inherit_org ON public.fis_attempts;
DROP FUNCTION IF EXISTS public.fis_inherit_receipt_org();

-- 2. Triggers del perfil predeterminado
DROP TRIGGER IF EXISTS trg_fis_tax_profiles_ensure_default ON public.fis_tax_profiles;
DROP TRIGGER IF EXISTS trg_fis_tax_profiles_sync_default ON public.fis_tax_profiles;
DROP FUNCTION IF EXISTS public.fis_tax_profiles_ensure_default();
DROP FUNCTION IF EXISTS public.fis_tax_profiles_sync_default();

-- 3. Triggers de updated_at
DROP TRIGGER IF EXISTS update_fis_receipts_updated_at ON public.fis_receipts;
DROP TRIGGER IF EXISTS update_fis_merchants_updated_at ON public.fis_merchants;
DROP TRIGGER IF EXISTS update_fis_tax_profiles_updated_at ON public.fis_tax_profiles;

-- 4. Tablas, en orden inverso de dependencia.
--    Las policies y los índices se van con la tabla.
DROP TABLE IF EXISTS public.fis_cfdi;
DROP TABLE IF EXISTS public.fis_attempts;
DROP TABLE IF EXISTS public.fis_receipts;
DROP TABLE IF EXISTS public.fis_recipe_versions;
DROP TABLE IF EXISTS public.fis_merchants;
DROP TABLE IF EXISTS public.fis_tax_profiles;
