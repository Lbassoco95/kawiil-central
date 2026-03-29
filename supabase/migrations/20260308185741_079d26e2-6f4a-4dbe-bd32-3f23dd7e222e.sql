-- Tables already created in 20260308000000_internal_despacho.sql
-- Adding only missing policies if they don't exist

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Org users see internal_procedures') THEN
    CREATE POLICY "Org users see internal_procedures"
      ON public.internal_procedures FOR SELECT TO authenticated
      USING (organization_id = get_user_org_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin/manager insert internal_procedures') THEN
    CREATE POLICY "Admin/manager insert internal_procedures"
      ON public.internal_procedures FOR INSERT TO authenticated
      WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin/manager delete internal_procedures') THEN
    CREATE POLICY "Admin/manager delete internal_procedures"
      ON public.internal_procedures FOR DELETE TO authenticated
      USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Org users see internal_comunicados') THEN
    CREATE POLICY "Org users see internal_comunicados"
      ON public.internal_comunicados FOR SELECT TO authenticated
      USING (organization_id = get_user_org_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin/manager insert internal_comunicados') THEN
    CREATE POLICY "Admin/manager insert internal_comunicados"
      ON public.internal_comunicados FOR INSERT TO authenticated
      WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin/manager delete internal_comunicados') THEN
    CREATE POLICY "Admin/manager delete internal_comunicados"
      ON public.internal_comunicados FOR DELETE TO authenticated
      USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
  END IF;
END $$;
