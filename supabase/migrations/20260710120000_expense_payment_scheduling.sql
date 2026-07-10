-- Programación de pago de gastos y reembolsos.
-- Al aprobar un gasto se captura la fecha en que se debe realizar el pago y,
-- opcionalmente, si el gasto es reembolsable (cobrar al cliente o reembolsar al
-- trabajador). El flujo genera una tarea de pago/reembolso asignada al
-- responsable de pagos configurable desde el panel de administración.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_due_date date,
  ADD COLUMN IF NOT EXISTS payment_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reimbursement_type text,
  ADD COLUMN IF NOT EXISTS reimbursement_status text;

COMMENT ON COLUMN public.expenses.payment_due_date IS
  'Fecha en que se debe realizar el pago (capturada al aprobar el gasto).';
COMMENT ON COLUMN public.expenses.payment_task_id IS
  'Tarea de pago/reembolso generada al aprobar, asignada al responsable de pagos.';
COMMENT ON COLUMN public.expenses.reimbursement_type IS
  'Naturaleza del reembolso: NULL = no reembolsable, cobrar_cliente = el cliente nos debe reembolsar, reembolsar_trabajador = el despacho debe reembolsar al trabajador.';
COMMENT ON COLUMN public.expenses.reimbursement_status IS
  'Estatus del reembolso: NULL/pendiente/completado.';

-- Restringe los valores admitidos sin romper filas existentes (todas NULL al migrar).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_reimbursement_type_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_reimbursement_type_check
      CHECK (reimbursement_type IS NULL OR reimbursement_type IN ('cobrar_cliente', 'reembolsar_trabajador'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_reimbursement_status_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_reimbursement_status_check
      CHECK (reimbursement_status IS NULL OR reimbursement_status IN ('pendiente', 'completado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_payment_task ON public.expenses(payment_task_id);
CREATE INDEX IF NOT EXISTS idx_expenses_reimbursement ON public.expenses(reimbursement_type, reimbursement_status);
