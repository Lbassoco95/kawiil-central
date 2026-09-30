-- =================================================================
-- ROLLBACK de supabase/migrations/20260917120100_mtg_storage_bucket.sql
-- Proyecto: qppfampapbxdgednkofc  ·  Fecha: 2026-09-17  ·  Módulo: Múuch' (Juntas)
--
-- Idempotente. El bucket solo se elimina si está VACÍO: borrar
-- transcripciones, grabaciones y minutas de clientes tiene que ser una
-- decisión explícita, no el efecto colateral de un rollback.
-- =================================================================

DROP POLICY IF EXISTS "Mtg service_role full access" ON storage.objects;
DROP POLICY IF EXISTS "Mtg org delete" ON storage.objects;
DROP POLICY IF EXISTS "Mtg org update" ON storage.objects;
DROP POLICY IF EXISTS "Mtg org insert" ON storage.objects;
DROP POLICY IF EXISTS "Mtg org read" ON storage.objects;

DO $$
DECLARE
  v_objetos bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'mtg') THEN
    RAISE NOTICE 'mtg: el bucket no existe, nada que borrar';
    RETURN;
  END IF;

  SELECT count(*) INTO v_objetos FROM storage.objects WHERE bucket_id = 'mtg';

  IF v_objetos > 0 THEN
    RAISE NOTICE 'mtg: el bucket conserva % archivo(s); se dejan las policies quitadas pero el bucket intacto. Vacíalo a mano si de verdad quieres eliminarlo.', v_objetos;
    RETURN;
  END IF;

  DELETE FROM storage.buckets WHERE id = 'mtg';
  RAISE NOTICE 'mtg: bucket vacío, eliminado';
END $$;
