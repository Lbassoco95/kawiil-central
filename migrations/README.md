# Migraciones aplicadas directo en dashboard

Esta carpeta documenta migraciones SQL que se aplicaron **manualmente en el SQL editor de Supabase** (proyecto `qppfampapbxdgednkofc`) y que por tanto **no viven** en `supabase/migrations/`.

Desde 2026-08-24 también guarda los **rollback de acompañamiento** de migraciones que sí viven en `supabase/migrations/`. Motivo: el pipeline (`supabase db push --include-all`) es **forward-only** y no ejecuta rollbacks; poner el `.rollback.sql` junto a la migración haría que el CLI intentara aplicarlo como si fuera una migración más. Esos archivos se corren **a mano** en el SQL editor cuando hay que deshacer algo, y llevan sufijo `.rollback.sql` sin `.sql` hermano en esta carpeta.

Convención:

- Nombre: `YYYY-MM-DD_slug.sql` (script aplicado) + `YYYY-MM-DD_slug.rollback.sql` (reversión idempotente).
- El rollback debe usar `IF EXISTS` y revertir en orden inverso al script principal.
- Cada script lleva cabecera con fecha, proyecto y propósito.

## Tabla cronológica

| Fecha | Archivo | Resumen |
|---|---|---|
| 2026-04-20 | `2026-04-20_extend_agent_tasks_attachments.sql` | Añade `agent_tasks.attachment_refs jsonb` + CHECK de array + índice GIN parcial. Parte del Bloque A del plan v5 (agentes como pre-procesadores). |
| 2026-08-04 | `2026-08-04_reminder_collaborators.sql` | Tabla `reminder_collaborators` (+ índices, RLS, helpers `reminder_owner_id`/`is_reminder_collaborator` y políticas para compartir recordatorios). Ya estaba aplicada y registrada en `supabase_migrations.schema_migrations` en remoto, pero `supabase db push --include-all` la re-incluía y fallaba (relation/PK ya existen), bloqueando todo el pipeline. Se retiró de `supabase/migrations/` y se documenta aquí (contenido idempotente conservado). |
| 2026-08-24 | `2026-08-24_juun_fis_schema.rollback.sql` | **Rollback** de `supabase/migrations/20260825034512_juun_fis_schema.sql` (Ju'un, Bloque 1): borra las seis tablas `fis_*`, sus triggers y sus funciones. Destructivo. No toca los archivos del bucket `juun`. |
| 2026-08-24 | `2026-08-24_juun_storage_bucket.rollback.sql` | **Rollback** de `supabase/migrations/20260825034520_juun_storage_bucket.sql`: quita las policies del bucket `juun` y lo elimina **solo si está vacío**; si conserva archivos avisa y no borra nada. |
| 2026-08-24 | `2026-08-24_juun_merchants_seed.rollback.sql` | **Rollback** de `supabase/migrations/20260825034528_juun_merchants_seed.sql`: quita los 15 comercios sembrados (los tickets ya cargados quedan con `merchant_id` en NULL, no se pierden). Innecesario si se corre el rollback del esquema. |
| 2026-09-28 | `2026-09-28_portal_client_offboarding.rollback.sql` | **Rollback** de `20260928150600_portal_client_offboarding.sql` (B4, baja de cliente premier). Correr PRIMERO. Borra los registros de solicitudes de baja de clientes; no devuelve lo destruido. |
| 2026-09-28 | `2026-09-28_portal_offboarding.rollback.sql` | **Rollback** de `20260928150500_portal_offboarding.sql` (B2/B3). Restaura las funciones de baja de `…150200`. No devuelve lo destruido. |
| 2026-09-28 | `2026-09-28_portal_retention_terms.rollback.sql` | **Rollback** de `20260928150400_portal_retention_terms.sql` (B1). Pierde el registro de elecciones y los resguardos de constancias legales (anotarlos antes). |
| 2026-09-28 | `2026-09-28_portal_route_guard_health.rollback.sql` | **Rollback** de `20260928150300_portal_route_guard_health.sql` (V1). |
| 2026-09-28 | `2026-09-28_portal_account_deletion.rollback.sql` | **Rollback** de `20260928150200_portal_account_deletion.sql` (C4). Pierde solicitudes y resguardos; no revierte seudonimizaciones. |
| 2026-09-28 | `2026-09-28_portal_rate_limits.rollback.sql` | **Rollback** de `20260928150100_portal_rate_limits.sql` (C3). |
| 2026-09-28 | `2026-09-28_portal_csd_authorization.rollback.sql` | **Rollback** de `20260928150000_portal_csd_authorization.sql` (C2/C5). |
| 2026-09-28 | `2026-09-28_portal_isolation_guard.rollback.sql` | **Rollback** de `20260928140500_portal_isolation_guard.sql` (portal del cliente): quita las policies restrictivas `portal_deny_portal_accounts`, la de storage y el `pgrst.db_pre_request`. Después de los anteriores. |
| 2026-09-28 | `2026-09-28_portal_tickets.rollback.sql` | **Rollback** de `20260928140400_portal_tickets.sql`: quita policies, vista y RPC del portal sobre Ju'un. No borra tickets. |
| 2026-09-28 | `2026-09-28_portal_cfdi.rollback.sql` | **Rollback** de `20260928140300_portal_cfdi.sql`. Destructivo para datos del portal (facturas cargadas, emisiones, cancelaciones, registro de CSD). No toca `client_sat_certificates`. |
| 2026-09-28 | `2026-09-28_portal_documents.rollback.sql` | **Rollback** de `20260928140200_portal_documents.sql`. Borra mapeo y registro de documentos; el bucket `portal` solo si está vacío. |
| 2026-09-28 | `2026-09-28_portal_messaging.rollback.sql` | **Rollback** de `20260928140100_portal_messaging.sql`. Borra hilos y mensajes del portal. |
| 2026-09-28 | `2026-09-28_portal_core.rollback.sql` | **Rollback** de `20260928140000_portal_core.sql`. Correr AL FINAL. Borra cuentas del portal (y sus usuarios de Auth, por seguridad) y restaura `handle_new_user`. |
