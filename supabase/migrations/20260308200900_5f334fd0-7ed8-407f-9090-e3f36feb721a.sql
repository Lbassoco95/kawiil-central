
-- Step 1: Rename app_role enum values
ALTER TYPE public.app_role RENAME VALUE 'admin' TO 'transformador';
ALTER TYPE public.app_role RENAME VALUE 'manager' TO 'referente';
ALTER TYPE public.app_role RENAME VALUE 'staff' TO 'ejecutor';
ALTER TYPE public.app_role RENAME VALUE 'viewer' TO 'en_formacion';

-- Step 2: Update is_admin_or_manager function
CREATE OR REPLACE FUNCTION public.is_admin_or_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('transformador', 'referente')
  )
$$;

-- Step 3: Update handle_new_user to assign 'en_formacion' by default
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, organization_id, email, full_name)
  VALUES (
    NEW.id,
    'a0000000-0000-0000-0000-000000000001',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'en_formacion');
  
  RETURN NEW;
END;
$$;

-- Step 4: Update RLS policies that reference old enum values
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Transformadores manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'transformador'::public.app_role));

DROP POLICY IF EXISTS "Admin manage integrations" ON public.integrations;
CREATE POLICY "Transformador manage integrations" ON public.integrations
  FOR ALL TO authenticated
  USING ((organization_id = public.get_user_org_id(auth.uid())) AND public.has_role(auth.uid(), 'transformador'::public.app_role));

DROP POLICY IF EXISTS "Admin see integrations" ON public.integrations;
CREATE POLICY "Transformador see integrations" ON public.integrations
  FOR SELECT TO authenticated
  USING ((organization_id = public.get_user_org_id(auth.uid())) AND public.has_role(auth.uid(), 'transformador'::public.app_role));

-- Step 5: Rename areas table to celulas
ALTER TABLE public.areas RENAME TO celulas;
