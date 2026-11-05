# Marketing · Que los agentes de Marketing dejen tarea y latido (diseño, sin implementar)

Estado (4 nov 2026): **aplicado en producción** los pasos 1 (`mk_registrar_corrida` y `mk_latido_agente`, versión 20261104165545), 2 (vigía que registra, 20261104165612) y 3 (despliegue de `marketing-colchon` v11, handler v6). **Pendiente el paso 4**: una corrida manual para comprobar que deja las dos tareas; mientras tanto, la primera corrida real con registro será la de las 7:00 CDMX del 5 nov.
Se construyó con las opciones recomendadas de la sección 4 (**A1, B1, C1**), porque Dirección pidió subirlo «conforme corresponda» sin elegir otras.

Archivos:
- `supabase/migrations/20261104165545_marketing_registrar_corrida.sql` (`mk_registrar_corrida` y `mk_latido_agente`) y su reversa `tools/marketing/rollback_registrar_corrida.sql`.
- `supabase/migrations/20261104165612_marketing_vigia_registra.sql` (vigía que registra) y su reversa `tools/marketing/rollback_vigia_registra.sql`.
- `supabase/functions/_shared/colchon_run.ts` y `supabase/functions/marketing-colchon/index.ts` (v6 del handler): llaman a `mk_registrar_corrida` al terminar cada corrida real (las simuladas no se registran). 7 pruebas nuevas en `colchon_run.test.ts`.
- Pantalla: `agentesRegistroLogica.ts` / `AgentesRegistro.tsx` (señal por cadencia, objetivo y cumplimiento) + hook `useTareasMarketingAgentes`. 8 pruebas nuevas.
- Prueba contra Postgres real: `tools/marketing/prueba_registrar_corrida_pglite.mjs` (13 pruebas).
- Banda del servicio: los agentes de sistema ya **no cuentan** para «kawiil-agents» (su latido viene de Supabase, no de la VM).

## 1. Objetivo
Los 3 agentes de Marketing ya están en `agent_registry` (`marketing_vigilante`, `marketing_informe_diario`, `marketing_vigia`, `kind = 'system'`) pero aparecen «sin latido»: ninguna corrida deja rastro ahí. Se busca que cada corrida deje **una tarea en `agent_tasks`** y **actualice el latido y los contadores en `agent_registry`**, para verlos en la pestaña Agentes junto a los demás y medir si cumplen su objetivo. Sin avisos nuevos (solo panel).

## 2. Lo que ya existe (leído en producción el 4 nov)
- `agent_tasks`: obligatorios `organization_id`, `title`; `task_type` admite `scheduled`; `status` admite `pending, queued, in_progress, waiting_approval, completed, error, cancelled`; `agent_id` → `agent_registry` (FK, `SET NULL`).
- `ai_task_events`: obligatorios `task_id` (FK con cascada), `organization_id`, `event_type` (texto libre), `sequence`.
- Disparador `tr_ai_task_events_notify_completion`: al insertar un evento `completed`/`failed` busca `input_context->>'conversation_id'` de la tarea; **si no hay, sale sin notificar**. Las tareas de Marketing no llevarán `conversation_id`, así que no habrá avisos.
- Los agentes del registro y sus 54 tareas y 383 eventos viven en la organización global `00000000-0000-0000-0000-000000000001`; los usuarios, en `a0000000-0000-0000-0000-000000000001`.
- **Hallazgo:** la política de lectura de `ai_task_events` es «eventos de mi organización», así que ningún usuario ve hoy los eventos de los agentes (todos están en la global). `agent_tasks` y `agent_registry` sí son legibles por cualquier autenticado. La vista de agentes no usa eventos, por eso no se nota.

## 3. Propuesta
### 3.1 Una función única que registra la corrida: `mk_registrar_corrida`
Función SQL `SECURITY DEFINER`, con `search_path` fijo, **ejecutable solo por `service_role`** (`REVOKE` a `PUBLIC`, `anon`, `authenticated`), que en una sola transacción:
1. valida que el agente sea uno de los 3 de Marketing (`kind = 'system'` y nombre `marketing_*`); cualquier otro nombre se rechaza;
2. inserta la tarea en `agent_tasks` (`task_type = 'scheduled'`, `priority = 'normal'`, `status = 'completed'` o `'error'`, `started_at`/`completed_at`, `result_summary` corto, `result` solo con números y códigos, `input_context = {"origen":"pg_cron"}` sin `conversation_id`);
3. actualiza `agent_registry`: `last_heartbeat = now()`, `last_task_at = now()`, `tasks_completed` o `tasks_failed` + 1, y `status` en `idle` (o `error` si la corrida falló);
4. (opcional, ver decisión B) inserta los eventos `started` y `completed`/`failed`.

Ventajas: un solo lugar para probar (PGlite), lo llaman igual la Edge Function y el vigía, y ninguna otra función puede escribir en `agent_registry` por este camino.

### 3.2 Quién la llama
| Agente | Cuándo | Qué registra |
|---|---|---|
| Vigilante del colchón | cada corrida de `marketing-colchon` (7:00) | una tarea: «Colchón AAAA-MM-DD», resumen `instagram 22 verde; facebook 22 verde; linkedin 22 verde`, resultado con días y color por red y conteo de casos abiertos/actualizados/cerrados. `error` si hubo fallas (el texto de las fallas se recorta a 300 caracteres) |
| Informe diario | la misma corrida | una tarea: «Informe AAAA-MM-DD», resumen `N faltantes, N con error, N desconocidos`; `error` si no se pudo guardar el informe |
| Vigía | 7:30, dentro de `mk_vigia_colchon` | ver decisión A |

El registro nunca rompe la corrida: si falla, se suma a `fallas` (ningún error se calla, regla de siempre) y entra al caso único de falla de monitoreo.

### 3.3 Cambios en la pantalla
Hoy la señal es «en línea» si hubo latido en las últimas 2 h; un agente diario quedaría «inactivo» a las 9:00 aunque todo esté bien. Para los `kind = 'system'` la señal se calculará con su cadencia (`config.horario`): **al día** si la última corrida fue en las últimas 26 h, **atrasado** si no. Además se mostrará el objetivo y la meta de cada uno y si se cumple en la última corrida (colchón ≥ 14 días; informe publicado antes de las 7:30; vigía sin corridas faltantes). Solo frontend, solo lectura.

## 4. Decisiones que necesito de Dirección
**A. Latido del Vigía.** Se decidió que el vigía «solo escribe cuando no encuentra la corrida». Pero sin escribir nada su latido nunca se actualiza y aparecería «atrasado».
- *A1 (recomendada):* el vigía actualiza **solo** `last_heartbeat` en `agent_registry` cuando todo está bien (sin tarea, sin bitácora). Cuando no encuentra la corrida, además registra una tarea con `error` y abre el caso, como hoy.
- *A2:* no escribe nada si todo está bien y la pantalla deduce su estado del trabajo programado (`mk_agentes_estado`: última ejecución del cron), sin tocar `agent_registry`.

**B. Eventos (`ai_task_events`).** Por la política actual nadie los vería. *B1 (recomendada):* no escribir eventos; con la tarea basta. *B2:* escribirlos con la organización global como los demás agentes, por consistencia, sabiendo que hoy son invisibles para los usuarios.

**C. Organización de las tareas.** *C1 (recomendada):* la global, la misma de los agentes y de las demás tareas. *C2:* la de Marketing (`a000…`), pero quedaría separada de su agente y de las demás tareas.

## 5. Lo que se escribiría en producción (cada una por separado, con su confirmación)
1. **Migración:** crear `mk_registrar_corrida` con sus permisos (sin datos, sin cambiar nada existente).
2. **Migración:** reemplazar `mk_vigia_colchon` para que llame a `mk_registrar_corrida` según la decisión A.
3. **Despliegue de `marketing-colchon`** (v11) con la llamada a `mk_registrar_corrida` al terminar cada corrida. Fuera de 6:30–7:00 CDMX.
4. **Una corrida manual del colchón** para comprobar que deja las dos tareas y actualiza los contadores (escribe una lectura de colchón, un informe y 2 tareas).

Todo lo demás (función de pruebas, cambios de pantalla, documento) va en el repo y se verifica con pruebas antes de pedir nada.

## 6. Pruebas previstas
- PGlite: la función rechaza nombres que no sean los 3 agentes; deja tarea, contadores y latido; es idempotente en lo que debe; `anon` y `authenticated` no pueden ejecutarla; el disparador de notificaciones no crea ninguna notificación.
- Node: `correrColchon` llama al registro con el resumen correcto en corrida buena, con fallas y con lectura fallida; un fallo del registro se suma a `fallas` y no rompe la corrida.
- Vitest: señal «al día / atrasado» por cadencia para los `system`; objetivo y meta en la tarjeta.

## 7. Riesgos y reversa
- **Escritura diaria nueva** en `agent_tasks` (2 filas por día) y `agent_registry`: volumen insignificante.
- **Ruido en la lista de tareas** de la vista: aparecerán 2 tareas al día de tipo `scheduled`; se pueden filtrar por agente.
- **Reversa:** la función se elimina con `DROP FUNCTION`; las tareas y contadores quedan como historial (o se borran por agente); la Edge Function vuelve a v10 redesplegando el commit anterior; `mk_vigia_colchon` se restaura de su migración anterior.
