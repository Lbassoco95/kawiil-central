-- 2026-09-29 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929100000_backup_bucket_no_browser_read.sql.
-- Vuelve a dejar que un G4 (transformador) lea el bucket `backups` desde el navegador.
-- Solo si hay una razón explícita: el volcado contiene datos de todo central.
DROP POLICY IF EXISTS "Transformadores read backups" ON storage.objects;
CREATE POLICY "Transformadores read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'backups'
  AND has_role(auth.uid(), 'transformador'::app_role)
);
