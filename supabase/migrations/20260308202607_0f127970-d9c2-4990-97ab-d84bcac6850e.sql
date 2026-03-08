
-- Create backups storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Only admins (transformador/referente) can read backups
CREATE POLICY "Admins read backups"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'backups'
  AND is_admin_or_manager(auth.uid())
);

-- Service role inserts (edge function uses service role, so no INSERT policy needed for authenticated)
