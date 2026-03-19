
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'solicitado',
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  description text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  rejection_reason text,
  receipt_path text,
  notes text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users create own expenses" ON public.expenses
FOR INSERT TO authenticated
WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND requested_by = auth.uid());

CREATE POLICY "Users see own expenses" ON public.expenses
FOR SELECT TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND (
  requested_by = auth.uid() OR has_finance_access(auth.uid())
));

CREATE POLICY "Finance update expenses" ON public.expenses
FOR UPDATE TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND (
  requested_by = auth.uid() OR has_finance_access(auth.uid())
));

CREATE POLICY "Admin delete expenses" ON public.expenses
FOR DELETE TO authenticated
USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
