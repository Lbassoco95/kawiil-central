
-- DELETE policies for admin/manager on main tables
CREATE POLICY "Admin/manager delete clients" ON public.clients FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete projects" ON public.projects FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Org users delete tasks" ON public.tasks FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND (is_admin_or_manager(auth.uid()) OR assigned_to = auth.uid() OR created_by = auth.uid()));

CREATE POLICY "Admin/manager delete areas" ON public.areas FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete catalog_tags" ON public.catalog_tags FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete document_types" ON public.document_types FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete tax_obligation_types" ON public.tax_obligation_types FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Org users delete accounting_periods" ON public.accounting_periods FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Admin/manager delete documents" ON public.documents FOR DELETE USING (organization_id = get_user_org_id(auth.uid()) AND (is_admin_or_manager(auth.uid()) OR uploaded_by = auth.uid()));
