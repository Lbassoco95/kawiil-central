# Múuch' — RUN-LOG (corrida B2→B5)

Fecha inicio: 2026-09-18 · Agente: Cursor Cloud · Base: `feat/mtg-juntas-b1` @ `66fac41e`

## §0.1 Reconocimiento

| Check | Resultado |
|-------|-----------|
| Rama B1 remota | OK |
| Prod tablas/migraciones | OK (Polo): 11 `mtg_*`, bucket, sin `20260918` Cursor |
| JSON Anexo A en Downloads | **Ausente** en cloud → script listo; carga pendiente |
| kawiil-agents | No en VM → `worker/mtg` Node |
| Harness local Postgres | No brew PG en cloud → tests unitarios + evidencia Polo |
| MCP Supabase | Auth timeout; no bloquea |
| PR B1→main | Ya existía #316 |

## Decisiones por ambigüedad

- Worker Node en `worker/mtg` (prompt §0.1).
- PRs apilados: ramas `feat/mtg-juntas-b{2..5}` con `skip_branch_prefix_check` (nombre pedido por Polo).
- Migraciones B3/B4/B5 **no** aplicadas a prod desde este agente (regla 7: harness local PG no corrió aquí). Quedan en repo para `db push` tras harness en Mac de Polo/Windsurf.
- Seed real: no ejecutado (sin JSON).

## B2 — Tablero

- Rutas `/juntas/:id`, `/juntas/:id/minuta`, `/grupos/:id`
- `prepareBoard` / `prepareMeetingBoard`, captura acuerdos→tareas, start/end
- Seeds `load-demo.ts` + `load-grupo-sylon.ts`
- Tests prepareBoard, lifecycle, noClientDataLeak, noDirectModelCalls

## B3 — Graph + cola

- `job_queue` + claim/complete/fail + cron invoke
- Edges: `job-queue-dispatch`, `mtg-outlook`, `mtg-graph-admin`, `mtg-graph-webhook`
- `mtg_unmatched_transcripts`
- Worker mock Graph/VTT
- Lista ALTO Polo en README

## B4 — Minuta

- `generateMinutes.ts` + prompt `minutes-v1` + mock gateway
- `documents.client_group_id`
- UI minuta stub + worker generate_minutes
- Pantalla confirmación completa de proposed queda parcial (listado + flujo worker); confirmar/rechazar UI detallada = deuda menor documentada

## B5 — Avisos

- `mtg_series.slack_channel_id`
- README roadmap + contrato Donna propuesto (sin implementar)
- Recordatorios T-1: parcialmente documentados; hook a `notifications` pendiente de cable fino (anotado)

## Prod apply

**No** se corrió `supabase db push` desde Cursor en esta corrida.
