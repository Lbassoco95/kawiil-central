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
| 2026-09-29 | `2026-09-29_backup_bucket_no_browser_read.rollback.sql` | **Rollback** de `supabase/migrations/20260929100000_backup_bucket_no_browser_read.sql`: vuelve a dejar que un G4 lea el bucket `backups` desde el navegador. No borra archivos. Solo con una razón explícita. |
