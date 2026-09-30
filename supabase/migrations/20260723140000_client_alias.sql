-- =============================================================
-- Conmutador ↔ Finanzas — Alias de clientes
-- Permite ligar una llamada (CONT/cobranza) al cliente de Finanzas por un
-- nombre alterno/alias (razón social corta, marca, apodo), además del nombre
-- exacto de public.clients. Lo usa sw-brief para el enlace a cartera.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.client_alias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  alias           text NOT NULL,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Un alias único por organización (case-insensitive) para un match determinista.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_alias_org_alias
  ON public.client_alias (organization_id, lower(alias));
CREATE INDEX IF NOT EXISTS idx_client_alias_client
  ON public.client_alias(client_id);

COMMENT ON TABLE public.client_alias IS
  'Alias/nombres alternos de clientes de Finanzas para emparejar llamadas del Conmutador (sw-brief) por nombre/empresa además del nombre exacto de clients.';

-- =============================================================
-- RLS: la org lee; administra quien tiene acceso a Finanzas o es admin/manager.
-- =============================================================
ALTER TABLE public.client_alias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org reads client_alias" ON public.client_alias;
CREATE POLICY "Org reads client_alias" ON public.client_alias
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Finance manages client_alias" ON public.client_alias;
CREATE POLICY "Finance manages client_alias" ON public.client_alias
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (public.has_finance_access(auth.uid()) OR public.is_admin_or_manager(auth.uid()))
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (public.has_finance_access(auth.uid()) OR public.is_admin_or_manager(auth.uid()))
  );
