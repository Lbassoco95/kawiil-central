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

## B4 — Minuta (cierre 2026-09-18)

- `minutesReview.ts` + tests: no aprobar con `proposed`/incompletos; `confirmRequires`; parse temas; remindKinds
- `approveMinutes.ts`: confirmar→tarea, rechazar, aprobar PDF/`documents`, Slack, cerrar+propagar temas
- `JuntaMinuta.tsx`: columna derecha completa (proyecto sugerido + reason, owner_hint, VTT signed URL, incompletos, enviar con preview)
- Test integración mock: `minutesFlow.integration.test.ts` (MTG_GATEWAY_MOCK)

## B5 — Avisos (cierre 2026-09-18)

- `remind.ts`: encolar T-1d/T-1h idempotente; cancelar al cancelar junta
- `useMtgSeries`: tras `mtg_generate_series_meetings` encola reminds; campo `slack_channel_id`
- `MtgSeriesDialog`: input canal Slack
- Worker: kind `mtg.remind` → `notifications`
- `slack-notify`: `mtg_minutes_approved` (canal del payload; sin minuta/VTT)
- README: contrato Donna + roadmap

## Ops / harness

- `verify.sh` ampliado a 5 migraciones + `checks-b345.sql` (claim concurrente, lease, dead, FK group, slack)
- Log → `tools/mtg/local-db/last-run.log` (*.log ignorado)
- **Cloud Cursor 2026-09-18:** sin Postgres brew, sin `supabase` CLI autenticado, sin JSON Sylon en Downloads → harness/db push/seed/aceptación **bloqueados** (lista ALTO abajo)

## Prod apply

**No** se corrió `supabase db push` desde Cursor Cloud en esta corrida.
Pendiente en Mac Polo tras harness verde: `20260918140000`, `20260918140100`, `20260918140200`.

## [ALTO — requiere a Polo]

1. Entra / admin consent Graph (tenant kawiil.mx) + Application Access Policy Teams (PowerShell).
2. Secrets Supabase: `MTG_GRAPH_CLIENT_STATE`, `MTG_WEBHOOK_PUBLIC_URL`; opcional Graph mail de reminds.
3. VM: `OPENCLAW_GATEWAY_URL` + token; compose `host.docker.internal`; correr `worker/mtg`.
4. Mac: `brew` Postgres + `tools/mtg/local-db/verify.sh`; luego `supabase db push` de las 3 migraciones; seed Sylon desde `~/Downloads/mtg-seed-grupo-sylon-2026-09-17.json`; recorrido §6 con capturas en `docs/mtg/acceptance/` (gitignored).

## Conteos Sylon (esperados; no verificados en cloud)

total 31 · vizum 13 / sylon 10 / rivium 8 · resolved 9 / advanced 9 / unchanged 7 / new 3 / blocked_third_party 2 / waiting_authority 1 / decision_needed 0 · decisiones 6 · expected_next 16

