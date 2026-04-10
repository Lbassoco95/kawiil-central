-- Escritura Savio: permiso explícito y bitácora (plan savio_escritura_facturas_pagos).

ALTER TABLE public.finance_income_viewers
  ADD COLUMN IF NOT EXISTS can_write_savio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.finance_income_viewers.can_write_savio IS
  'Si true, el usuario puede invocar savio-finance-write (crear cargo / registrar pago). Requiere fila en finance_income_viewers.';

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
      AND f.can_write_savio IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.can_write_savio_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_savio_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_savio_finance(uuid) TO service_role;

DROP POLICY IF EXISTS "finance_income_viewers_update_admin" ON public.finance_income_viewers;
CREATE POLICY "finance_income_viewers_update_admin"
  ON public.finance_income_viewers
  FOR UPDATE
  TO authenticated
  USING (
    is_admin_or_manager(auth.uid())
    AND organization_id = get_user_org_id(auth.uid())
  )
  WITH CHECK (
    is_admin_or_manager(auth.uid())
    AND organization_id = get_user_org_id(auth.uid())
    AND get_user_org_id(user_id) = organization_id
  );

CREATE TABLE IF NOT EXISTS public.savio_write_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  savio_path text NOT NULL,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  savio_http_status integer,
  ok boolean NOT NULL DEFAULT false,
  error_message text,
  savio_response_excerpt text
);

CREATE INDEX IF NOT EXISTS idx_savio_write_log_org_created ON public.savio_write_log (organization_id, created_at DESC);

ALTER TABLE public.savio_write_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "savio_write_log_select_admin_org" ON public.savio_write_log;
CREATE POLICY "savio_write_log_select_admin_org"
  ON public.savio_write_log
  FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
    AND is_admin_or_manager(auth.uid())
  );

COMMENT ON TABLE public.savio_write_log IS
  'Registro de llamadas de escritura a Savio (Edge service_role inserta filas).';
