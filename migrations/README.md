# Migraciones aplicadas directo en dashboard

Esta carpeta documenta migraciones SQL que se aplicaron **manualmente en el SQL editor de Supabase** (proyecto `qppfampapbxdgednkofc`) y que por tanto **no viven** en `supabase/migrations/`.

Convención:

- Nombre: `YYYY-MM-DD_slug.sql` (script aplicado) + `YYYY-MM-DD_slug.rollback.sql` (reversión idempotente).
- El rollback debe usar `IF EXISTS` y revertir en orden inverso al script principal.
- Cada script lleva cabecera con fecha, proyecto y propósito.

## Tabla cronológica

| Fecha | Archivo | Resumen |
|---|---|---|
| 2026-04-20 | `2026-04-20_extend_agent_tasks_attachments.sql` | Añade `agent_tasks.attachment_refs jsonb` + CHECK de array + índice GIN parcial. Parte del Bloque A del plan v5 (agentes como pre-procesadores). |
| 2026-08-04 | `2026-08-04_reminder_collaborators.sql` | Tabla `reminder_collaborators` (+ índices, RLS, helpers `reminder_owner_id`/`is_reminder_collaborator` y políticas para compartir recordatorios). Ya estaba aplicada y registrada en `supabase_migrations.schema_migrations` en remoto, pero `supabase db push --include-all` la re-incluía y fallaba (relation/PK ya existen), bloqueando todo el pipeline. Se retiró de `supabase/migrations/` y se documenta aquí (contenido idempotente conservado). |
