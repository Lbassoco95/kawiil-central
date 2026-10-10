# Recordatorios de cobranza (RF-03)

Recordatorios automáticos de pago sobre las facturas pendientes (aging), enviados
por el servicio `notify` (correo; WhatsApp si hay credenciales).

## Cadencia

- **antes_venc** — 3 días antes del vencimiento efectivo.
- **al_vencer** — el día del vencimiento.
- **atraso** — cada 5 días de atraso (día 5, 10, 15, …).

El vencimiento efectivo sale de `v_aging_invoices` (due_date de Savio o emisión + 5 días).

## Seguridad (apagado por defecto)

- **No envía nada** salvo que el secret `REMINDERS_ENABLED='true'` esté puesto.
  Sin él, la función corre en **dry-run**: registra en `reminder_log` lo que
  enviaría (estado `omitido`, motivo `recordatorios_desactivados`) para revisión.
- **Pausa por cliente**: `savio_customers.reminders_paused` (toggle 🔔/🔕 en la
  pestaña Cartera). Un cliente en pausa nunca recibe recordatorios.
- **Dedupe**: índice único `(org, factura, stage, día)` para envíos reales; la
  función además verifica antes de insertar. No se manda dos veces el mismo día.
- Solo facturas con saldo pendiente (excluye pagadas/canceladas).

## Piezas

| Archivo | Rol |
|---|---|
| `supabase/migrations/20260721170000_reminders.sql` | `reminder_template` (plantillas editables + semilla), `reminder_log`, `savio_customers.reminders_paused`. |
| `supabase/migrations/20260721170500_reminder_cron.sql` | Cron diario 13:00 UTC (~07:00 CDMX). |
| `supabase/functions/reminder-cron/index.ts` | Recorre aging, arma el mensaje desde la plantilla y envía vía `notify`; respeta pausa, dedupe y el flag global. |
| `src/hooks/useCollectionReminders.ts` | Bitácora (`reminder_log`) y toggle de pausa por cliente. |
| Toggle 🔔 en pestaña Cartera | Pausar/reactivar recordatorios por cliente. |

## Plantillas

Editables en `reminder_template` (una por stage y organización). Placeholders:
`{cliente}`, `{folio}`, `{monto}`, `{vencimiento}`, `{dias}`.

## Activación en producción

1. Poblar datos: correr `savio-sync` (las facturas deben existir en local).
2. Verificar plantillas y pausas.
3. Poner `REMINDERS_ENABLED='true'` en Edge Functions → Secrets.
4. Confirmar que `savio_customers.email` trae el correo del cliente (viene de Savio).

Requiere además `CRON_SECRET` (Secrets + Vault `cron_secret`) y los secrets de
`notify` (Slack/Graph/WhatsApp).
