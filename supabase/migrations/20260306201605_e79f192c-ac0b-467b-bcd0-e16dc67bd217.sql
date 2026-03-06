
DROP POLICY "Admin/manager create clients" ON public.clients;

CREATE POLICY "Org users create clients"
ON public.clients
FOR INSERT
TO authenticated
WITH CHECK (organization_id = get_user_org_id(auth.uid()));
