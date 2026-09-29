-- =================================================================
-- backup-data · A4: ningún rol del navegador lee el bucket `backups`.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-29
-- Rollback (a mano): migrations/2026-09-29_backup_bucket_no_browser_read.rollback.sql
--
-- El bucket ya era privado (20260308202607), pero la política «Transformadores
-- read backups» (20260308202914) dejaba a cualquier G4 descargar desde el navegador
-- el volcado completo. Los respaldos solo se leen con service_role (Dashboard de
-- Supabase o la propia función, que exige credencial). No borra ningún archivo.
-- =================================================================
UPDATE storage.buckets SET public = false WHERE id = 'backups' AND public IS DISTINCT FROM false;
DROP POLICY IF EXISTS "Transformadores read backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins read backups" ON storage.objects;
