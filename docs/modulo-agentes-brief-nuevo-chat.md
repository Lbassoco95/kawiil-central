# Módulo «Agentes» de kawiil-central · brief para iniciar su desarrollo (nuevo chat)

Escrito el 4 nov 2026 desde el chat del módulo Marketing. Este documento es el punto de partida del módulo que mostrará **cómo trabajan los agentes del registro de kawiil-central (los de Cerebro / `kawiil-agents`)**. Los agentes de **Marketing se quedan en el módulo Marketing** (`/marketing`); no se mezclan.

## 1. Qué se quiere
- Un módulo propio (ruta nueva, por ejemplo `/agentes`) para **ver a los agentes del registro trabajando**: quién está activo, qué está haciendo ahora, qué hizo, si falló y si cumple su objetivo.
- La inspiración es el proyecto [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT): una «oficina» de pixel art donde cada agente es un personaje que camina, escribe o lee según lo que hace. Dirección quiere **ver** el trabajo de los agentes, no solo tablas.
- Los agentes de Marketing (`marketing_vigilante`, `marketing_informe_diario`, `marketing_vigia`) ya tienen su vista en `/marketing` → pestaña Agentes. Este módulo **no los incluye** (o, como mucho, los enlaza a Marketing).

## 2. Cómo está construido hoy (verificado en producción el 3–4 nov 2026)
| Pieza | Qué es |
|---|---|
| `agent_registry` | Catálogo. 25 agentes `kind='consultable'` (Coyolli, Amatl, Balam, Nelli, Tlahtolli, Metztli, Ollin, Teocuitl, Tepantli, Tequitl, Tlahtoani, Tochtli, Yollotl, Atl… y los `legal_*`; 5 están archivados) + 3 `kind='system'` de Marketing. Columnas: `name, display_name, description, role, status (idle/working/resting/error/offline/archived), model, capabilities, config, last_heartbeat, last_task_at, tasks_completed, tasks_failed, kind`. |
| `agent_tasks` | Una fila por tarea: `agent_id, task_type, title, instructions, status (pending/queued/in_progress/waiting_approval/completed/error/cancelled), started_at, completed_at, result, result_summary, error_message, input_context, execution_metadata, created_by…`. |
| `ai_task_events` | Eventos de avance de cada tarea: `task_id, agent_id, user_id, organization_id, event_type, sequence, progress, payload`. Tipos vistos: `started, attachments_processing_started/completed, attachment_processed, thinking, response_generated, insight_generation_started, insight_written, completed, failed`. |
| `client_agents` | Instancias por cliente de cada agente consultable. |
| `list-agents` (función) | Lista los agentes `consultable` no archivados para el selector del chat. |
| `dispatch-to-agent` (función, `verify_jwt=true`) | Valida al usuario y el agente y reenvía la tarea por HTTP a la VM (`VM_DISPATCH_URL`, token `KAWIIL_DISPATCH_TOKEN`). **El frontend y las funciones no escriben `agent_tasks`**: lo hace la VM. |
| **`kawiil-agents`** | Servicio FastAPI que corre **en la Mac de Leo** (`127.0.0.1:8000`, credenciales en `~/.openclaw/credentials/kawiil-agents.env`, clave de servicio propia `kawiil-agents-mac`). Ejecuta las tareas y escribe `agent_tasks`, `ai_task_events`, `agent_activity_logs`, `agent_memories`. Ver `docs/seguridad/plan-seguridad-kawiil-os.md` (secciones 5.9 y 5.10). |
| Cerebro (MCP «Cerebro_Kawiil») | Memoria compartida Louis ↔ Cowork: agenda, memoria, entregables, acervo legal y `dispatch_preparar_brief`. Corre en `louis-prod` (Hetzner), aparte del servicio de agentes. **Falta documentar cómo se conecta con `kawiil-agents` y con `dispatch-to-agent`** (la herramienta `dispatch_preparar_brief` y los «briefs pendientes» sugieren un camino; no está confirmado). |
| Frontend existente | `src/pages/AsistenteIA.tsx`, `src/components/ai/AgentTaskCard.tsx`, `DelegateToAgentDialog.tsx`, `src/hooks/useAgentTaskProgress.ts` (Realtime por tarea con reconexión y *polling* de respaldo), `src/lib/agentTaskResult.ts`, `agentTaskErrorUserMessage.ts`. |

## 3. Estado real hoy (importante)
- **Sin actividad desde el 7 jun 2026**: último latido de cualquier agente, última tarea y último evento. 54 tareas en total (22 completadas, 28 con error, 3 pendientes, 1 en curso) y todas `task_type='manual'`. `legal_dof_watchdog` figura `working` desde entonces (atascado). `legal_archivist`: 15 de 17 tareas con error.
- Puede que la VM esté apagada, o simplemente sin uso. **No se pudo verificar desde la nube** (la Mac no es alcanzable). Preguntar a Dirección si `kawiil-agents` está encendido y cómo se reinicia.
- Un módulo «en vivo» solo tendrá algo que mostrar cuando la VM esté escribiendo.

## 4. Hallazgos técnicos que cambian el diseño
1. **Organizaciones distintas:** agentes, tareas y eventos están en la organización global `00000000-0000-0000-0000-000000000001`; los usuarios (`profiles`) en `a0000000-0000-0000-0000-000000000001`. No se puede filtrar por organización.
2. **`ai_task_events` no es legible por los usuarios:** su política dice «eventos de mi organización» y los 383 eventos están en la global. Hoy ningún usuario ve eventos (ni siquiera los de sus propias tareas). `agent_registry`, `agent_tasks` y `agent_activity_logs` sí se leen con sesión de usuario (política `true` para `authenticated`). Para una vista «en vivo» hay que decidir cómo exponer los eventos: política ajustada, vista de solo lectura o función. **Es una escritura en producción: pedir confirmación a Dirección.**
3. **Privacidad:** `agent_tasks.title`, `instructions`, `result` y `error_message` pueden contener datos de expedientes de clientes. La vista de Marketing ya trae solo `id, agent_id, task_type, status` y fechas. Mantener ese criterio salvo decisión expresa de Dirección.
4. **`dispatch-to-agent` solo valida que el agente exista** (no su tipo): una llamada directa a la API podría despachar a un agente `system`. Ninguna pantalla lo ofrece.
5. Las funciones de lectura de agentes (`list-agents`) filtran `kind='consultable'`.

## 5. Cómo funciona Pixel Agents (lo que se vio en su repositorio)
- Es una extensión de VS Code o una CLI (`npx pixel-agents`) que sirve una oficina en el navegador. Stack: React 19, Vite, Canvas 2D, Fastify. MIT.
- **Su fuente de datos son sesiones de Claude Code**: lee las transcripciones JSONL en `~/.claude/projects/` e instala *hooks* en `~/.claude/settings.json`. Por eso **no puede mostrar a los agentes de kawiil-central tal cual**: estos escriben en Supabase.
- Lo reutilizable es la idea: estado del agente → animación (caminar al escritorio, escribir, leer, esperar). Verificar la licencia de los *sprites* y del código antes de copiar nada; atribuir si se adapta.
- Seguridad si alguien lo instala localmente: el token de la URL es una credencial, dejarlo en `127.0.0.1`, no activar «Skip Permissions».

## 6. Propuesta para el módulo
**Fuente de datos:** `agent_registry` (estado, latido, contadores) + `agent_tasks` (qué corre) + `ai_task_events` (qué hace ahora), con Realtime siguiendo el patrón de `useAgentTaskProgress`.

**Mapa de estados → «oficina» (ejemplo):**
| Dato | Personaje |
|---|---|
| `status = idle` con latido reciente | sentado, descansando |
| tarea `in_progress` + evento `started` / `attachments_processing_*` | llega al escritorio |
| evento `thinking` | piensa / lee |
| evento `response_generated`, `insight_*` | escribe |
| `completed` | celebra y vuelve a su sitio |
| `failed` / tarea `error` | marca roja |
| sin latido > 7 días | apagado / gris («sin señal») |
| `status = working` sin latido > 1 h | atascado |

**Orden sugerido de construcción:**
1. **Fase 1 (solo lectura, sin tocar producción):** lista y tarjetas de los agentes del registro + historial de tareas (reutilizar y **mover a un lugar compartido** `src/components/marketing/agentesRegistro.ts` y `AgentesRegistro.tsx`, que ya implementan señal, tasa de éxito, tareas recientes y banda del servicio `kawiil-agents`; hoy la pestaña de Marketing los usa en modo `soloMarketing`). Coordinar el movimiento para no romper Marketing (tiene pruebas en `src/test/marketingAgentesRegistro.test.tsx`).
2. **Fase 2:** la «oficina» (Canvas 2D o SVG) alimentada por esos datos, con datos de ejemplo mientras la VM esté apagada.
3. **Fase 3 (con confirmación de Dirección):** exponer `ai_task_events` a los usuarios y activar Realtime.
4. **Fase 4:** objetivos y cumplimiento por agente (como los de Marketing: objetivo declarado + meta medible).

## 5b. Reglas de trabajo que vienen de este proyecto (respetarlas)
- **Ninguna escritura en producción sin confirmación explícita de Dirección** (migración, función desplegada, política, dato). Se pide con la lista exacta de lo que se escribiría.
- **Nunca pedir ni pegar secretos** (tokens, claves); se piden los nombres, nunca los valores.
- **No desplegar entre 6:30 y 7:00 (hora de Ciudad de México)**: corre el trabajo diario de Marketing.
- Sin avisos por correo, Slack ni WhatsApp para estas vistas: solo en pantalla.
- Pruebas antes de pedir nada: Vitest para la lógica y los componentes; Postgres en memoria (PGlite, ver `tools/marketing/prueba_*_pglite.mjs`) para SQL.
- Estilo visual **Zen + Glass** (`docs/direccion-visual-zen-glass.md`).
- El flujo `deploy-supabase.yml` despliega al fusionar a `main` cambios en `supabase/functions/**`, `supabase/migrations/**` y `supabase/config.toml` (CLI fijado en 2.122.1). Mover una migración a `supabase/migrations/` solo después de aplicarla, con la versión real del registro de Supabase.

## 6b. Preguntas para Dirección al empezar
1. ¿La VM `kawiil-agents` está encendida? ¿Quién la reinicia y cómo?
2. ¿Quién debe ver el módulo: todos los usuarios, solo Dirección o por permiso?
3. ¿Se pueden ver títulos y resultados de las tareas, o solo agente, tipo, estado y duración?
4. ¿Cómo se relaciona Cerebro (Louis) con `kawiil-agents`: quién crea las tareas y por qué camino (`dispatch_preparar_brief`, `dispatch-to-agent`)?
5. ¿La «oficina» es obligatoria desde la primera versión o primero tablas y después lo visual?
6. ¿Se adapta el código/arte de Pixel Agents (MIT) o se diseña uno propio?

## 7. Archivos clave para leer primero
`supabase/functions/dispatch-to-agent/index.ts`, `supabase/functions/list-agents/index.ts`, `src/hooks/useAgentTaskProgress.ts`, `src/components/ai/AgentTaskCard.tsx`, `src/lib/agentTaskResult.ts`, `src/components/marketing/agentesRegistro.ts`, `src/components/marketing/AgentesRegistro.tsx`, `docs/seguridad/plan-seguridad-kawiil-os.md` (5.9 y 5.10), `docs/marketing-estado-produccion.md`, `docs/marketing-agentes-registro-diseno.md`, migraciones `20260508130000_agent_multitenancy_schema.sql`, `20260421130000_ai_task_events.sql`, `20260615120000_notify_agent_task_completion.sql`.
