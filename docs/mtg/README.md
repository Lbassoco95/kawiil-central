# Múuch' — módulo de Juntas (`mtg_*`)

Múuch' ordena la vida de las juntas con un cliente: la serie recurrente (cadencia, agenda base, aviso de transcripción), cada reunión con su máquina de estados, los temas persistentes que viven entre juntas, los acuerdos y decisiones, y las versiones de la minuta. En este Bloque 1 está el esquema completo, el bucket privado `mtg`, la pestaña "Juntas" en la ficha del cliente y la bitácora append-only.

## Modelo de datos

| Tabla | Qué guarda |
|---|---|
| `mtg_series` | Serie de juntas anclada a un cliente o a un grupo (cadencia, duración, asistentes, agenda base, aviso de transcripción, datos de Outlook/Teams). |
| `mtg_meetings` | Cada junta: instancia de una serie o ad hoc (`series_id NULL`), con horario, estado, facilitador y datos de transcripción. |
| `mtg_topics` | Temas persistentes de la serie: viven entre juntas hasta `resolved` o `dropped`. |
| `mtg_topic_updates` | Movimiento de un tema en una junta concreta (uno por tema por junta). |
| `mtg_agenda_items` | Bloques de la agenda de una junta (sección, tema, decisión, punto libre). |
| `mtg_decisions` | Decisiones levantadas en la junta; pueden apuntar al acuerdo que generan. |
| `mtg_expected_next` | Compromisos "esperados para la próxima" anotados al cierre. |
| `mtg_agreements` | Compromisos capturados en la junta; los del modelo nacen `proposed` y se confirman en revisión; al confirmarse pueden dar tarea. |
| `mtg_minutes` | Versiones de la minuta; a lo más una `approved` por junta. El PDF va al bucket `mtg`, no a `documents`. |
| `mtg_graph_subscriptions` | Suscripciones de Microsoft Graph para transcripciones de Teams. Solo `service_role`. |
| `mtg_audit_log` | Bitácora append-only del módulo (ver abajo). |

## Máquina de estados de `mtg_meetings.status`

```
planned → in_progress → ended → minutes_draft → minutes_review → minutes_approved → closed
```

Salidas laterales: `cancelled`, `no_show`.

## Tenancy

El tenant es la **organización** (`organization_id` + RLS con `get_user_org_id`), como el resto del repo. La serie se ancla a:

- `anchor_type='client'` → `public.clients` (y `client_id` duplica el ancla; CHECK `anchor_id = client_id`), o
- `anchor_type='group'` → `public.client_groups` (CHECK `client_id IS NULL`).

El trigger `mtg_series_validate_anchor` exige que el ancla exista y sea de la misma organización. Las series de grupo se muestran en la ficha de cada cliente miembro, en solo lectura.

## Bucket `mtg` y convención de ruta

Bucket privado, con policies por primer segmento de ruta (`= organization_id`):

```
{organization_id}/mtg/{anchor_type}/{anchor_id}/{yyyy}/{mm}/{tipo}/{timestamp}_{nombre}.{ext}
```

`tipo` ∈ `transcripts | recordings | minutes | evidence`. Lectura solo por signed URL de vida corta (300 s). **La minuta aprobada va aquí** (`mtg_minutes.document_path`), NO en `documents`. Las lecturas de `documents` ya soportan `metadata.bucket` para apuntar a otro bucket (`src/lib/documentBucket.ts`).

## Bitácora append-only

`mtg_audit_log`: INSERT lo hace el usuario autenticado (`actor_user_id = auth.uid()`, org por RLS); SELECT por org. No hay policies de UPDATE/DELETE, los permisos están revocados para `authenticated`, `anon` y `service_role`, y el trigger `mtg_audit_log_immutable` aborta cualquier UPDATE/DELETE. El front escribe vía `logMtgAudit` (`src/lib/mtg/audit.ts`), que además deja una línea resumen en `activity_log` con `entity_type = 'mtg_<entidad>'`.

## Cómo probar el Bloque 1

1. Migración local: `tools/mtg/local-db/verify.sh` levanta un Postgres temporal (puerto 54329), aplica stub + ambas migraciones, corre `checks.sql` (RLS, generación de instancias, trigger de ancla, CHECKs, bitácora, storage) y prueba los rollbacks e idempotencia.
2. Front: `npm run dev`, abrir la ficha de un cliente → pestaña **Juntas**. Crear una serie con cadencia (genera 8 juntas vía `mtg_generate_series_meetings`) y una junta ad hoc.

## Diff propuesto para el compose de la VM (no aplicado)

Para que `kawiil-agents` (en `nexo-louis/cloud/hetzner/docker-compose.yml`) alcance `openclaw-gateway`, que corre como systemd nativo en el host escuchando en `127.0.0.1:3000` — por eso `localhost` dentro del contenedor no sirve y se usa `host.docker.internal`:

```yaml
  kawiil-agents:
    # ...existente...
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      # ...existente...
      OPENCLAW_GATEWAY_URL:   ${OPENCLAW_GATEWAY_URL:-http://host.docker.internal:3000}
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN}
```

## Roadmap / fuera de v1

- Side panel de Teams
- Portal del cliente
- Recall.ai (grabación/transcripción alternativa)
- Propuesta de avance desde Slack o correo
- Webhook saliente Donna/Cerebro (contrato abajo; **no implementado**)

## Contrato webhook saliente (Donna / Cerebro) — no implementado

Cuando exista un consumidor externo, Múuch' podría emitir (vía cola o Edge) eventos firmados:

```json
{
  "event": "mtg.minutes_approved" | "mtg.meeting_closed" | "mtg.agreement_confirmed",
  "occurred_at": "ISO-8601",
  "organization_id": "uuid",
  "meeting_id": "uuid",
  "series_id": "uuid|null",
  "payload": {
    "title": "string",
    "scheduled_at": "ISO-8601",
    "confirmed_agreements": [{ "text": "...", "owner": "...", "due_date": "YYYY-MM-DD|null" }],
    "movement_counts": { "advanced": 1 },
    "link": "/juntas/{id}/minuta"
  }
}
```

Reglas: **nunca** incluir minuta completa, VTT ni PII del cliente más allá de lo ya visible en Slack interno. Auth: HMAC compartido + allowlist de IPs. Este contrato es documentación; no hay endpoint ni secretos aún.

## Bloques 2–5 (esta corrida)

### Rutas
- `/juntas/{meeting_id}` — Tablero
- `/juntas/{meeting_id}/minuta` — Minuta (B4): confirmar/rechazar proposed, incompletos, aprobar PDF, enviar/cerrar
- `/grupos/{group_id}` — Ficha mínima de grupo

### Cola `job_queue`
Migración `20260918140000_job_queue.sql`. Claim: `claim_jobs`. Kinds: `mtg.fetch_transcript`, `mtg.generate_minutes`, `mtg.remind`. Cron → Edge `job-queue-dispatch` → worker `worker/mtg`.

### Recordatorios (B5)
Al crear/sincronizar instancias: jobs `mtg.remind` con `run_after = scheduled_at - 24h` y `- 1h`, idempotentes por `(meeting_id, remind_kind)`. Cancelar junta → jobs a `dead`. Worker inserta `notifications` (+ web push / Graph mail cuando secretos existan).

### Slack al aprobar minuta
Si `mtg_series.slack_channel_id` (editable en el diálogo de serie): `slack-notify` con `event_type=mtg_minutes_approved` (conteos, acuerdos confirmados, link). Sin minuta ni transcripción.

### Graph / Teams — [ALTO — requiere a Polo]
1. Entra (tenant **kawiil.mx**), app kawiil-central: permisos de aplicación `OnlineMeetings.Read.All`, `OnlineMeetingTranscript.Read.All`, `OnlineMeetingRecording.Read.All` + **admin consent**.
2. PowerShell Teams:
   ```powershell
   New-CsApplicationAccessPolicy -Identity Kawiil-Mtg -AppIds "<MICROSOFT_CLIENT_ID>"
   Grant-CsApplicationAccessPolicy -PolicyName Kawiil-Mtg -Identity <upn-organizador>
   ```
3. Secrets Supabase: `MTG_GRAPH_CLIENT_STATE`, `MTG_WEBHOOK_PUBLIC_URL`.
4. Confirmar `MICROSOFT_TENANT_ID` = tenant kawiil.mx (solo id, no secret).
5. Facturación Azure opcional (>600 min/mes evaluación).
6. VM: `OPENCLAW_GATEWAY_URL` + token; compose `extra_hosts: host.docker.internal:host-gateway`.

Mocks: `MTG_GRAPH_MOCK=1`, `MTG_GATEWAY_MOCK=1`.

### Seed
- Demo: `npx tsx tools/mtg/seed/load-demo.ts`
- Grupo real: JSON fuera del repo + `load-grupo-sylon.ts` (ver `tools/mtg/seed/README.md`)

### Costos Graph
Cuota evaluación ~600 min/mes/app; luego ≈ USD 0.0022/min transcripción, 0.003/min grabación. Sin facturación → 402. Copilot AI insights **no** se usan.

### Harness local
`tools/mtg/local-db/verify.sh` — B1 + job_queue + unmatched + documents/slack; log en `last-run.log` (ignorado).
