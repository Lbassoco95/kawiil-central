-- Escritura Savio: alinear con rol Kawiil «transformador» (antes «admin» de app).
-- El rol «admin» en el producto Savio (app.savio.mx) no se sincroniza con Kawiil.

-- Quien ya es transformador y tiene fila de visor de ingresos, obtiene escritura Savio en base de datos.
UPDATE public.finance_income_viewers f
SET can_write_savio = true
FROM public.user_roles ur
WHERE ur.user_id = f.user_id
  AND ur.role = 'transformador'::public.app_role;

CREATE OR REPLACE FUNCTION public.can_write_savio_finance(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.finance_income_viewers f
    WHERE f.user_id = _user_id
      AND f.organization_id = get_user_org_id(_user_id)
      AND (
        f.can_write_savio IS TRUE
        OR public.has_role(_user_id, 'transformador'::public.app_role)
      )
  );
$$;

COMMENT ON FUNCTION public.can_write_savio_finance(uuid) IS
  'True si el usuario tiene fila en finance_income_viewers y (can_write_savio o rol transformador en Kawiil).';
