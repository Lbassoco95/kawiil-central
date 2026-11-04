# Marketing · Estado en producción (proyecto `qppfampapbxdgednkofc`)

Actualizado: 4 nov 2026 (después de registrar los agentes de Marketing en `agent_registry`; el 3 nov se fusionaron #469, #471, #473 y #474 y se redesplegaron las funciones desde el repo).

## Migraciones aplicadas (versión real del registro de Supabase)
El repo ya usa estas mismas versiones como nombre de archivo en `supabase/migrations/`.

| Versión en producción | Nombre | Qué hace |
|---|---|---|
| `20261031205319` | `marketing_modulo_base` | Tablas `mk_*`, RLS, permisos y reglas v1 |
| `20261031210227` | `marketing_revocar_anon` | Quita privilegios de `anon` sobre `mk_*` |
| `20261031211300` | `marketing_seguridad_cierres` | Cierres de seguridad 1, 3 y 4 (ver abajo) |
| `20261102022104` | `marketing_api_log` | `mk_api_log`, registro de solo inserción de cada llamada al conector |
| `20261102023909` | `marketing_colchon` | `mk_colchon`, `mk_informe_diario`; amplía `mk_caso.tipo` y `mk_bitacora.agente` |
| `20261102033958` | `marketing_vigia_colchon` | Función `mk_vigia_colchon` (vigía de las 7:30) |
| `20261103203209` | `marketing_agentes_estado` | Función de lectura `mk_agentes_estado()` para la vista Agentes |
| `20261104015632` | `marketing_registrar_agentes` | Registra 3 agentes de Marketing en `agent_registry` (ver abajo) |

`20261103045435_fix_scheduled_recurring_tasks_no_cascade` está en el registro pero **no es de Marketing**: se aplicó fuera del repo y en `supabase/migrations/` hay un archivo marcador sin efecto para que `supabase db push` no aborte. Si el SQL real llega en otro PR, reemplazar el marcador (misma versión).

## Funciones y trabajos programados
| Pieza | Estado en producción | Notas |
|---|---|---|
| `marketing-metricool` | v7, `verify_jwt = false` | Conector de solo lectura con marca fija y lista cerrada. Incluye el modo «forma» (`operacion: "forma:<op>"`: solo campos, tipos y números permitidos; falla cerrado en un conector sin ese modo). El repo contiene exactamente este código (v7 = redespliegue desde el flujo, mismo código que v6). |
| `marketing-colchon` | v10 (código de la versión 5), `verify_jwt = false` | Se autentica con `x-marketing-secret`, lee Metricool solo por el conector. Un caso abierto por red mientras el colchón < 14 días; un único caso `falla_monitoreo` ante fallas. El repo contiene este código (v10 = redespliegue desde el flujo). |
| `marketing-metricool-perfiles` | v10, `verify_jwt = true`, desactivada (410) | Función temporal ya sin uso. |
| Trabajo `marketing-colchon-diario-0700-cdmx` | activo, `0 13 * * *` (7:00 CDMX) | Última corrida correcta: 3 nov 13:00 UTC. Registro en `tools/marketing/cron_colchon_0700.sql`. |
| Trabajo `marketing-colchon-vigia-0730-cdmx` | activo, `30 13 * * *` (7:30 CDMX) | Solo escribe si no hay corrida registrada. Última corrida correcta: 3 nov 13:30 UTC. Registro en `tools/marketing/cron_vigia_0730.sql`. |

Regla del colchón: días desde hoy (CDMX) hasta la última pieza programada pendiente y sin borrador por red; verde ≥ 14, amarillo 7–13, rojo < 7.

## Contenido de las tablas (3 nov 2026)
- 94 piezas (31 jul 2026 → 14 ene 2027) y 264 filas de pieza por red; 121 resultados; 15 reglas; 27 filas de colchón; 9 informes diarios; 32 de bitácora; 15 de `mk_api_log`; 0 propuestas.
- Casos: 9 en total, 6 abiertos y 3 cerrados. Abiertos: caso 1 (investigación de Instagram, septiembre) y casos 2–6 («dato sospechoso» de LinkedIn). Los casos 7, 8 y 9 (colchón en Instagram, Facebook y LinkedIn) se cerraron el 3 nov a las 15:42 CDMX, en una ejecución manual del colchón con la fecha real: el colchón se recuperó a 22 días (última pieza programada el 25 nov, 14 piezas por red; a las 7:00 estaba en 4 días y en rojo). Sin duplicados. Ningún caso `falla_monitoreo` abierto. Hoy hay dos lecturas de colchón con fecha 3 nov (7:00 y 15:42).
- Registro de agentes de kawiil-central (lectura): 28 agentes (25 consultables: 20 activos y 5 archivados, más los 3 de Marketing); 54 tareas, la última del 7 jun 2026; último latido de cualquier agente el 7 jun 2026 y `legal_dof_watchdog` figura «trabajando» desde entonces (la pantalla lo marca como atascado).
- Carga del historial: `tools/marketing/carga_historial.sql`, organización `a0000000-0000-0000-0000-000000000001` («Kawiil Demo»). **Pendiente de Dirección: confirmar que es la organización de Kawiil MX.**
- Calendario nov 2026 – ene 2027: `tools/marketing/carga_calendario_nov2026_ene2027.sql` (ejecutado, verificado con `verificar_calendario_nov2026_ene2027.sql`).

## Agentes de Marketing en `agent_registry` (4 nov 2026)
Migración `20261104015632_marketing_registrar_agentes` (aplicada con confirmación de Dirección). Tres filas `kind = 'system'`, estado `idle`, sin modelo de IA, solo lectura, en la organización global de agentes (`00000000-0000-0000-0000-000000000001`):

| Nombre | Se muestra como | Horario | Objetivo declarado |
|---|---|---|---|
| `marketing_vigilante` | Vigilante del colchón | todos los días 7:00 CDMX (`marketing-colchon`) | colchón de 14 días o más en las tres redes |
| `marketing_informe_diario` | Informe diario | todos los días 7:00 CDMX (`marketing-colchon`) | informe de faltantes cada día antes de las 7:30 |
| `marketing_vigia` | Vigía del colchón | todos los días 7:30 CDMX (`mk_vigia_colchon`) | ninguna corrida diaria falta sin un caso de falla abierto |

- Solo registro: **no escriben latidos ni tareas todavía**. En la pestaña Agentes aparecen «sin latido» hasta que `marketing-colchon` y el vigía dejen una tarea en `agent_tasks` y eventos en `ai_task_events` (siguiente paso, con confirmación aparte).
- `kind = 'system'` los deja fuera de `list-agents` (solo ofrece los consultables): no salen en el selector del chat ni se instancian por cliente. `dispatch-to-agent` solo valida que el agente exista, así que una llamada directa a la API podría despachar una tarea a uno de ellos, que la VM no sabría atender; ninguna pantalla lo ofrece.
- El Revisor no se registra: todavía no existe.
- Reversa: `tools/marketing/rollback_registrar_agentes.sql` (borra solo esas 3 filas y se salta las que ya tengan tareas). Prueba: `tools/marketing/prueba_registrar_agentes_pglite.mjs`.

## Interfaz (`/marketing`)
Panel con colchón e informe de faltantes, calendario, casos, semáforo, reglas (valores vigentes e historial), estado de monitoreo y la pestaña **Agentes**. Acceso con permiso que falla cerrado. Todo de solo lectura.

La pestaña **Agentes** tiene dos partes:
- **Agentes de Marketing** (Vigilante, Informe diario, Vigía): tarjetas, línea de tiempo y flujo de un caso; usa `mk_agentes_estado()` y, sin ella, el horario previsto.
- **Agentes de kawiil-central** (#473, 3 nov 2026): lee `agent_registry` y `agent_tasks` con la sesión del usuario (RLS de lectura de autenticados ya existente; sin migración).
  - Banda del servicio `kawiil-agents` (la VM que corre en la Mac de Leo y escribe esas tablas): en línea si algún agente activo dio latido en las últimas 2 h; si no, «sin señal».
  - Tarjeta por agente: estado, último latido, última tarea, tareas completadas y con error con su porcentaje. Señales: en línea (latido ≤ 2 h), inactivo (≤ 7 días), sin señal (> 7 días), sin latido, atascado («trabajando» sin latido > 1 h) y archivado (oculto hasta pedirlo).
  - Tareas recientes (30 días, con «Ver todo el historial»), con filtros por agente y «solo con error».
  - Privacidad: de `agent_tasks` solo se piden `id, agent_id, task_type, status` y fechas; no se piden título, instrucciones, resultado ni mensaje de error. Una prueba lo comprueba.
  - No despacha tareas ni toca la VM. Quien opera esos agentes (no Marketing) es `kawiil-agents`; los trabajos de Marketing corren con `pg_cron` y todavía no están registrados en `agent_registry` (propuesta pendiente, ver abajo).
  - Código: `src/components/marketing/agentesRegistro.ts`, `AgentesRegistro.tsx`, hooks `useAgentesRegistro` y `useTareasAgentes`; pruebas en `src/test/marketingAgentesRegistro.test.tsx`.

## Despliegue
- Frontend: Vercel (producción en cada fusión a `main`).
- Supabase: `.github/workflows/deploy-supabase.yml` (CLI fijado en `2.122.1` y `--yes`, desde #471; con `latest` el CLI 3.0.0 pedía confirmación y el flujo fallaba). Se activa al fusionar cambios en `supabase/functions/**`, `supabase/migrations/**` o `supabase/config.toml`. Manual: Actions → Deploy Supabase → Run workflow; con el campo de función vacío solo despliega lo que cambió en el último commit, y las migraciones pendientes se aplican siempre.
- Reversa: `git revert -m 1` del commit de fusión; las migraciones aplicadas son aditivas.

## Regla de trabajo (Dirección)
- El módulo y los agentes solo **leen** de Metricool: nunca publican, editan, borran ni reprograman.
- Nunca se pide ni se pega el token de Metricool: se piden los nombres de los secretos, nunca los valores.
- Toda escritura en producción (migración, carga, despliegue de función, secreto, permiso, trabajo programado) requiere confirmación explícita de Dirección en el mismo mensaje, una lista por escritura.
- No desplegar entre las 6:30 y las 7:00 (CDMX).
- Solo avisos en el panel (sin correo, Slack ni WhatsApp). Sondeos solo en modo «forma». Tendencias: solo diseño.
- Antes de asignar permisos se confirma con qué cuenta entra cada persona; no se insertan permisos de prueba.

## Seguridad sobre mk_* (asesor de Supabase)
Cerrado el 31 oct (`marketing_seguridad_cierres`, confirmado por Dirección):
1. `mk_solo_insercion` y `mk_semana_inicio` con `search_path = public, pg_temp`.
3. `mk_semaforo_semana`, `mk_sembrar_reglas_v1` y `mk_recalcular_primera_publicacion` ya no son ejecutables por `anon` ni `authenticated` (solo propietario y `service_role` en las dos primeras).
4. `mk_recalcular_primera_publicacion` (disparador) ya no es ejecutable por `anon`.

Abierto por diseño:
2. Las tablas `mk_*` siguen visibles en GraphQL para `authenticated` (aviso `pg_graphql_authenticated_table_exposed`). Acceso filtrado por RLS y `mk_can_view`; cerrar el `SELECT` rompería las pantallas que leen directo. Decisión de Dirección pendiente.
- Siguen ejecutables por `authenticated` a propósito: `mk_can_view`, `mk_can_decide`, `mk_org_id` (las usan las políticas RLS), `mk_cambiar_regla`, `mk_decidir_propuesta` (validan `marketing_decidir` por dentro) y `mk_agentes_estado` (devuelve vacío si no hay permiso de ver). El asesor del 3 nov no muestra ninguna tabla ni función `mk_*` expuesta a `anon`.

## Pendiente (no aplicado en producción)
Entrega 2, cada escritura con su confirmación:
- `supabase/pendientes/20261103000000_marketing_semaforo_corregido.sql`: una fila por pieza (corte `7d` si existe, si no `acumulado`) para no contar doble. Hoy no cambia ningún promedio ni color.
- Función de lectura de resultados (simulacro), carga histórica de Instagram (44 publicaciones), recálculo de semáforo y cobertura, Vigilante de publicación con su trabajo programado, umbrales de Instagram con `mk_cambiar_regla` y su nota (`supabase/pendientes/20261101130000_marketing_nota_umbral_instagram.sql` se descartará).
- LinkedIn: la ruta de analíticas devolvió 0 elementos dos veces. Decidir entre aprobar la ruta CSV `/v2/analytics/posts/linkedin` o revisar el tipo de cuenta.
- Que cada corrida de los agentes de Marketing (ya registrados) deje una tarea en `agent_tasks` y eventos en `ai_task_events`, y actualice latido y contadores en `agent_registry`, para medir su objetivo (colchón ≥ 14 días, informe cada día antes de las 7:30, cero corridas faltantes) en la pestaña Agentes. Requiere cambios en `marketing-colchon` y en `mk_vigia_colchon`; cada escritura con su confirmación. El disparador de notificaciones existente solo avisa si la tarea trae `conversation_id`, así que no habría avisos nuevos.
- Resumen semanal a Cerebro como entregable de «Kawiil MX»: falta confirmar cómo se autentica una función de Supabase contra Cerebro.
- Servicio `kawiil-agents`: sin latidos desde el 7 jun 2026. Confirmar con Dirección si la VM está encendida; la vista solo mostrará historial hasta que se reactive.
- Rama `claude/marketing-reglas-detalle`: no se toca hasta que Dirección indique borrarla.
