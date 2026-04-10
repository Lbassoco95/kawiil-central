-- Quién puede ver ingresos / Savio (además del acceso al módulo Finanzas para gastos).
-- Tras aplicar la migración, insertar filas manualmente, por ejemplo:
--
--   INSERT INTO public.finance_income_viewers (organization_id, user_id)
--   SELECT get_user_org_id(u.id), u.id
--   FROM auth.users u
--   WHERE lower(u.email) IN (
--     'leo.bassoco@tudominio.com',
--     'vturcott@tudominio.com',
--     'jturcott@tudominio.com'
--   );
--
-- O por user_id conocido:
--   INSERT INTO public.finance_income_viewers (organization_id, user_id)
--   VALUES ('a0000000-0000-0000-0000-000000000001', 'uuid-del-usuario');

CREATE TABLE IF NOT EXISTS public.finance_income_viewers (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_income_viewers_user ON public.finance_income_viewers(user_id);

ALTER TABLE public.finance_income_viewers ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve su propia fila (depuración / transparencia).
DROP POLICY IF EXISTS "Users see own finance income viewer row" ON public.finance_income_viewers;
CREATE POLICY "Users see own finance income viewer row"
  ON public.finance_income_viewers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.can_view_savio_finance(_user_id uuid)
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
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_savio_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_savio_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_savio_finance(uuid) TO service_role;

DROP POLICY IF EXISTS "Finance access see savio events" ON public.savio_webhook_events;
DROP POLICY IF EXISTS "Savio income viewers see webhook events" ON public.savio_webhook_events;

CREATE POLICY "Savio income viewers see webhook events"
  ON public.savio_webhook_events
  FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
    AND can_view_savio_finance(auth.uid())
  );
