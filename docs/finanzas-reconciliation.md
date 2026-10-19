# Conciliación pago → factura (RF-04)

Aplica pagos (`savio_payments`) a facturas (`savio_invoices`) y deja lo ambiguo en
una cola para resolución manual. Adaptado a la arquitectura actual (pagos/facturas
materializados de Savio en vez de una tabla `payment` propia).

## Piezas

| Archivo | Rol |
|---|---|
| `supabase/migrations/20260721180000_reconciliation.sql` | `payment_invoice` (junction), `reconciliation_queue`, `savio_payments.source`/`fx_rate`, vista `v_reconciliation_summary`. |
| `supabase/migrations/20260721180500_reconcile_cron.sql` | Cron diario 06:30 UTC (tras savio-sync). |
| `supabase/functions/reconcile-payments/index.ts` | Auto-match + encolado. Auth dual usuario/cron. |
| `src/hooks/useReconciliation.ts` | Cola, disparo, resolución manual e ignorar. |
| `src/components/finanzas/ReconciliationPanel.tsx` | Panel en la pestaña Cartera. |

## Auto-match (conservador)

1. **Referencia directa**: el pago trae `invoice_savio_id` de una factura abierta → se aplica.
2. **Cliente + monto**: única factura abierta del cliente cuyo saldo ≈ pago → se aplica.
3. Cualquier otro caso → `reconciliation_queue`:
   - `sin_factura` — sin cliente o sin facturas abiertas.
   - `ambiguo` — varias (o ninguna exacta) facturas del cliente.
   - `sobrepago` — el pago excede 1.5× el saldo objetivo; requiere **concepto** al aplicar.

`payment_invoice` es único por `(org, pago, factura)` y la cola única por `(org, pago)`
→ idempotente: correr la conciliación varias veces no duplica ni deja pagos sin registro.

## Resolución manual

En la pestaña **Cartera → Conciliación de pagos**: botón "Conciliar ahora" y, por cada
pago en cola, elegir la factura destino (con concepto si es sobrepago) o ignorar.

## Resumen por cliente

`v_reconciliation_summary` da facturado / cobrado / pendiente por cliente y moneda
(base del "al día / pendiente" que alimenta la cobranza).

## Requisitos

Datos poblados por `savio-sync`. Los pagos requieren `customer_savio_id` o
`invoice_savio_id` en el payload de Savio para auto-matchear; si no vienen, caen a
la cola (nunca se pierden).
