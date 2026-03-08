
-- Drop the old policy that allows referentes too
DROP POLICY IF EXISTS "Admins read backups" ON storage.objects;

-- Create new policy only for transformadores
CREATE POLICY "Transformadores read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'backups'
  AND has_role(auth.uid(), 'transformador'::app_role)
);
