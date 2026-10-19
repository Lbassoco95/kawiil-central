-- v_aging (RF-02): antigüedad de saldos de cartera por cliente y moneda, sobre
-- las facturas materializadas de Savio (savio_invoices) menos los pagos aplicados
-- (savio_payments). Buckets: corriente, 1–15, 16–30, 31–60, >60 días.
--
-- Vencimiento efectivo (espíritu de RF-01): si Savio no envía due_date, se deriva
-- como invoice_date + 5 días (fallback conservador). Solo cuenta saldo pendiente.
--
-- security_invoker = true: la vista respeta el RLS de las tablas base, de modo
-- que solo usuarios de Finanzas de la organización ven sus datos.

CREATE OR REPLACE VIEW public.v_aging
WITH (security_invoker = true) AS
WITH inv AS (
  SELECT
    i.organization_id,
    i.id AS invoice_id,
    i.savio_id,
    i.client_id,
    i.customer_savio_id,
    i.folio,
    UPPER(COALESCE(NULLIF(i.currency, ''), 'MXN')) AS currency,
    COALESCE(i.amount, 0) AS amount,
    COALESCE(i.due_date, i.invoice_date + INTERVAL '5 days')::date AS effective_due,
    COALESCE((
      SELECT SUM(p.amount)
        FROM public.savio_payments p
       WHERE p.organization_id = i.organization_id
         AND p.invoice_savio_id = i.savio_id
    ), 0) AS paid
  FROM public.savio_invoices i
  WHERE LOWER(COALESCE(i.status, '')) NOT IN (
    'cancelled','canceled','cancelada','void','anulada',
    'paid','pagada','pagado','settled','liquidada','closed','cerrada'
  )
),
pending AS (
  SELECT
    inv.*,
    GREATEST(amount - paid, 0) AS balance,
    (CURRENT_DATE - effective_due) AS days_late
  FROM inv
  WHERE GREATEST(amount - paid, 0) > 0.005
)
SELECT
  organization_id,
  client_id,
  customer_savio_id,
  currency,
  COUNT(*)::int AS invoices,
  SUM(balance) AS total_balance,
  SUM(CASE WHEN days_late <= 0 THEN balance ELSE 0 END) AS corriente,
  SUM(CASE WHEN days_late BETWEEN 1 AND 15 THEN balance ELSE 0 END) AS d1_15,
  SUM(CASE WHEN days_late BETWEEN 16 AND 30 THEN balance ELSE 0 END) AS d16_30,
  SUM(CASE WHEN days_late BETWEEN 31 AND 60 THEN balance ELSE 0 END) AS d31_60,
  SUM(CASE WHEN days_late > 60 THEN balance ELSE 0 END) AS d60_plus,
  MAX(days_late)::int AS max_days_late
FROM pending
GROUP BY organization_id, client_id, customer_savio_id, currency;

GRANT SELECT ON public.v_aging TO authenticated;

-- Vista de detalle por factura (para desglosar un cliente en la UI).
CREATE OR REPLACE VIEW public.v_aging_invoices
WITH (security_invoker = true) AS
WITH inv AS (
  SELECT
    i.organization_id,
    i.id AS invoice_id,
    i.savio_id,
    i.client_id,
    i.customer_savio_id,
    i.folio,
    UPPER(COALESCE(NULLIF(i.currency, ''), 'MXN')) AS currency,
    COALESCE(i.amount, 0) AS amount,
    i.status,
    COALESCE(i.due_date, i.invoice_date + INTERVAL '5 days')::date AS effective_due,
    i.due_date IS NULL AS due_date_estimated,
    COALESCE((
      SELECT SUM(p.amount)
        FROM public.savio_payments p
       WHERE p.organization_id = i.organization_id
         AND p.invoice_savio_id = i.savio_id
    ), 0) AS paid
  FROM public.savio_invoices i
  WHERE LOWER(COALESCE(i.status, '')) NOT IN (
    'cancelled','canceled','cancelada','void','anulada',
    'paid','pagada','pagado','settled','liquidada','closed','cerrada'
  )
)
SELECT
  organization_id, invoice_id, savio_id, client_id, customer_savio_id, folio,
  currency, amount, paid, status, effective_due, due_date_estimated,
  GREATEST(amount - paid, 0) AS balance,
  (CURRENT_DATE - effective_due) AS days_late
FROM inv
WHERE GREATEST(amount - paid, 0) > 0.005;

GRANT SELECT ON public.v_aging_invoices TO authenticated;
