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
