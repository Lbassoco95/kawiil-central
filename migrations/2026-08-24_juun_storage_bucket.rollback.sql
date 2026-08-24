-- =================================================================
-- ROLLBACK de supabase/migrations/20260825034520_juun_storage_bucket.sql
-- Proyecto: qppfampapbxdgednkofc  ·  Fecha: 2026-08-24  ·  Módulo: Ju'un
--
-- Idempotente. El bucket solo se elimina si está VACÍO: borrar archivos de
-- clientes (CSF, tickets, CFDI, evidencia) tiene que ser una decisión
-- explícita, no el efecto colateral de un rollback.
-- =================================================================

DROP POLICY IF EXISTS "Juun service_role full access" ON storage.objects;
DROP POLICY IF EXISTS "Juun org delete" ON storage.objects;
DROP POLICY IF EXISTS "Juun org update" ON storage.objects;
DROP POLICY IF EXISTS "Juun org insert" ON storage.objects;
DROP POLICY IF EXISTS "Juun org read" ON storage.objects;

DO $$
DECLARE
  v_objetos bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'juun') THEN
    RAISE NOTICE 'juun: el bucket no existe, nada que borrar';
    RETURN;
  END IF;

  SELECT count(*) INTO v_objetos FROM storage.objects WHERE bucket_id = 'juun';

  IF v_objetos > 0 THEN
    RAISE NOTICE 'juun: el bucket conserva % archivo(s); se dejan las policies quitadas pero el bucket intacto. Vacíalo a mano si de verdad quieres eliminarlo.', v_objetos;
    RETURN;
  END IF;

  DELETE FROM storage.buckets WHERE id = 'juun';
  RAISE NOTICE 'juun: bucket vacío, eliminado';
END $$;
