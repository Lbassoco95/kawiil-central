
CREATE TABLE public.user_celulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  celula_id uuid NOT NULL REFERENCES public.celulas(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, celula_id)
);

ALTER TABLE public.user_celulas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see user_celulas" ON public.user_celulas
FOR SELECT TO authenticated
USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admin/manager manage user_celulas" ON public.user_celulas
FOR ALL TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE OR REPLACE FUNCTION public.user_in_celula(_user_id uuid, _celula_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_celulas uc
    JOIN public.celulas c ON c.id = uc.celula_id
    WHERE uc.user_id = _user_id AND c.slug = _celula_slug
  )
$$;

CREATE OR REPLACE FUNCTION public.has_finance_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_celulas uc
    JOIN public.celulas c ON c.id = uc.celula_id
    WHERE uc.user_id = _user_id AND c.slug IN ('finanzas', 'administracion')
  ) OR is_admin_or_manager(_user_id)
$$;
