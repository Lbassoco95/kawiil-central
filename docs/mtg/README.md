# Múuch' — juntas con clientes (mtg_*)

Estado: **Bloque 1** (esquema, cola genérica, bucket `mtg`, semilla Sylon, pestaña Juntas detrás de flag).

## Migraciones

| Archivo | Contenido |
|---------|-----------|
| `20260918120000_async_worker_jobs.sql` | Cola `async_worker_jobs` + `claim_async_worker_jobs()` (SKIP LOCKED) |
| `20260918120100_mtg_schema.sql` | Tablas `mtg_*`, `mtg_audit_log` append-only, `tasks.mtg_meeting_id` |
| `20260918120200_mtg_storage_bucket.sql` | Bucket privado `mtg` |
| `20260918120300_mtg_seed_grupo_sylon.sql` | Grupo Sylon + series de ejemplo |

Rollbacks en `migrations/2026-09-18_*.rollback.sql`.

## Front

- `VITE_MTG_JUNTAS_ENABLED=true` → pestaña **Juntas** en `ClienteDetalle`.
- Minutas futuras: fila en `documents` con `metadata.bucket = 'mtg'` y `file_path` en bucket `mtg` (preview/descarga ya soportan bucket vía `documentStorageBucket`).

## §0 Grupo Sylon (prod, 2026-09-17)

- **Sin** `parent_client_id` en `clients`. Agrupación: `client_groups` + `client_group_members`.
- Tres clientes sueltos: Vizum Technologies, Sylon Capital, Sylon Asesores (Rivium). No existía grupo «Grupo Sylon»; la semilla lo crea.
- **Proyectos:** discriminador `projects.area` (`service_area`: contabilidad, legal, juicios, cumplimiento, …). Sin `template_key`. Cada entidad tiene proyectos Contabilidad / Legal / Cumplimiento (+ juicio activo en Vizum).

## Graph (Bloque 3)

Juntas organizadas solo desde tenant **kawiil.mx**. Columnas `organizer_tenant_id` / `mtg_graph_subscriptions.tenant_id` listas; validación de cuenta Microsoft en Bloque 3.
