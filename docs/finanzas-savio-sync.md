# savio-sync — Savio → tablas locales

Materializa las facturas, pagos y clientes de Savio (hoy solo en vivo) en tablas
locales de Postgres, para habilitar el resto de la Fase 1 (due_date obligatorio,
aging, recordatorios, conciliación pago→factura), que necesitan consultar y
derivar sobre esos datos.

**Aditivo y seguro:** los dashboards en vivo actuales siguen leyendo de la API
Savio sin cambios. Estas tablas son nuevas y se pueblan por separado.

## Piezas

| Archivo | Rol |
|---|---|
| `supabase/migrations/20260721150000_savio_sync_tables.sql` | Tablas `savio_invoices`, `savio_payments`, `savio_customers`, `savio_sync_runs` (+ RLS de lectura para Finanzas). |
| `supabase/migrations/20260721150500_savio_sync_cron.sql` | Cron diario (06:00 UTC) que invoca la función vía `pg_net` con `x-cron-secret` del Vault. |
| `supabase/functions/savio-sync/index.ts` | Edge Function: pagina Savio por cursor (sin tope de 100), hace UPSERT idempotente y registra cada corrida. |
| `src/hooks/useSavioSync.ts` | `useSavioSyncRuns` (bitácora) y `useTriggerSavioSync` (disparo manual). |
| Botón "Sincronizar Savio" | En el toolbar del dashboard de ingresos. |

## Modelo

- Idempotente por `(organization_id, savio_id)` → re-sincronizar hace UPSERT, nunca duplica.
- `client_id` se resuelve cruzando `customer_savio_id` contra `clients.savio_customer_id` de la organización.
- `savio_sync_runs` registra por recurso: `fetched`, `upserted`, `savio_reported_total` (si Savio lo expone), `truncated` y `discrepancy` — esto cubre el **job de verificación de conteos (RF-07)**: si `fetched != total` o se alcanzó el techo de páginas, `discrepancy = true`.

## Auth

- **Usuario** (JWT con `can_view_savio_finance`) → sincroniza SU organización (botón manual).
- **Sistema** (cron `x-cron-secret` o service-role) → sincroniza todas las organizaciones.

## Secrets requeridos

Los mismos que ya usa `savio-finance-api` + el del cron:
```
SAVIO_API_BASE_URL, SAVIO_API_KEY, (opcional) SAVIO_API_AUTH_MODE
CRON_SECRET  (Edge Functions → Secrets)  y  vault.create_secret(<valor>, 'cron_secret')
```

## Contrato de paginación de Savio (a confirmar)

El paginador entiende cursor bajo varias convenciones (`nextCursor`, `next_cursor`,
anidado en `paging`/`pagination`/`meta`). Si Savio pagina por `page`/`offset` en
vez de cursor, `savio_sync_runs.truncated` lo evidenciará (se detiene tras la 1ª
página) y habrá que extender `fetchAllSavio` con ese esquema. Confirmar contra
`app.savio.mx/docs` antes de asumir cobertura total.

## Siguiente

Sobre estas tablas se construyen: aging (`v_aging`), due_date obligatorio en el
alta de cargos, recordatorios automáticos (usando el servicio `notify`) y la
conciliación pago→factura.
