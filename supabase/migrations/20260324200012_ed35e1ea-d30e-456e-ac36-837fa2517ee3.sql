
-- Add settings jsonb column to organizations
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow transformadores to update organization settings
CREATE POLICY "Transformadores update org settings"
ON public.organizations
FOR UPDATE
TO authenticated
USING (id = get_user_org_id(auth.uid()) AND has_role(auth.uid(), 'transformador'::app_role))
WITH CHECK (id = get_user_org_id(auth.uid()) AND has_role(auth.uid(), 'transformador'::app_role));
