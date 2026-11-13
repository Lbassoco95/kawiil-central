# Marketing · Estado en producción (proyecto `qppfampapbxdgednkofc`)

Actualizado: 13 nov 2026 (verificado contra producción ese día). Desde el 4 nov: la oficina de agentes y el **Analista de resultados** (agente con IA, solo lectura) están en producción, con sus preguntas, seguimientos y trabajo diario de las 7:45; los trabajos de las 7:00, 7:30 y 7:45 corren todos los días sin fallas desde el 5/6 nov; y el simulacro de resultados de Metricool (`marketing-resultados`) está desplegado. El 4 nov: agentes de Marketing en `agent_registry` y registro de corridas; el 3 nov se fusionaron #469, #471, #473 y #474.

## Migraciones aplicadas (versión real del registro de Supabase)
El repo usa estas mismas versiones como nombre de archivo en `supabase/migrations/` (producción tenía 345 migraciones en total el 13 nov; las demás son de otros módulos). Regla: toda migración aplicada por MCP se guarda en `supabase/migrations/` con su versión real; si falta alguna, `db push` aborta y el flujo falla (pasó varias veces el 5 nov con migraciones de otros módulos).

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
| `20261104165545` | `marketing_registrar_corrida` | Funciones `mk_registrar_corrida` y `mk_latido_agente` (solo `service_role`) |
| `20261104165612` | `marketing_vigia_registra` | El vigía actualiza su latido (todo bien) o deja una tarea con error (no corrió); auxiliar `mk_vigia_registra_falla` |
| `20261105191631` | `marketing_analista_datos` | Función de lectura `mk_analista_datos` (10 herramientas de lista cerrada; solo `service_role`) |
| `20261105194055` | `marketing_analista_registro` | Agente `marketing_analista`, tabla `mk_consulta` (RLS: los usuarios solo leen) y las dos funciones de registro ampliadas al cuarto agente |
| `20261106003827` | `marketing_analista_seguimientos` | Tabla `mk_seguimiento` (RLS), columna `mk_consulta.seguimiento_id` y funciones `mk_seguimiento_crear`, `_cambiar` y `_reclamar` (solo `service_role`) |

`20261103045435_fix_scheduled_recurring_tasks_no_cascade` está en el registro pero **no es de Marketing**: se aplicó fuera del repo y en `supabase/migrations/` hay un archivo marcador sin efecto para que `supabase db push` no aborte. Si el SQL real llega en otro PR, reemplazar el marcador (misma versión).

## Funciones y trabajos programados
| Pieza | Estado en producción | Notas |
|---|---|---|
| `marketing-metricool` | v10 (13 nov), `verify_jwt = false` | Conector de solo lectura con marca fija y lista cerrada. Incluye el modo «forma» (`operacion: "forma:<op>"`: solo campos, tipos y números permitidos; falla cerrado en un conector sin ese modo). Sin cambios de código en el repo desde el 4 nov: las versiones más altas son redespliegues del mismo código. |
| `marketing-colchon` | v14 (handler v6; mismo código desde el 4 nov), `verify_jwt = false` | Se autentica con `x-marketing-secret`, lee Metricool solo por el conector. Un caso abierto por red mientras el colchón < 14 días; un único caso `falla_monitoreo` ante fallas. **Al terminar cada corrida real deja una tarea del Vigilante y otra del Informe diario en `agent_tasks` y actualiza latido y contadores** vía `mk_registrar_corrida` (las simuladas no se registran; un fallo al registrar no rompe la corrida y entra al caso de falla). Desplegada desde el flujo y igual al repo. |
| `marketing-agente` | v5 (código del #504, 5 nov), `verify_jwt = true` | **Analista de resultados**: exige sesión y el permiso de ver Marketing; lee solo por `mk_analista_datos`; verifica las cifras; guarda cada pregunta en `mk_consulta`. Acciones de seguimiento (crear, pausar, reanudar, terminar). Ver «Analista de resultados». |
| `marketing-seguimientos` | v4 (código del #504), `verify_jwt = false` | Trabajo diario de los seguimientos: secreto propio `x-marketing-secret`, reclama los vencidos y los responde con el mismo Analista. |
| `marketing-resultados` | v1, `verify_jwt = false` | Simulacro de resultados de Metricool (Entrega 2, #530, 11 nov): lee por el conector y devuelve el reporte de contraste; **no escribe nada** en la base. Ver `docs/marketing-entrega2-resultados.md`. |
| `marketing-metricool-perfiles` | v13, `verify_jwt = true`, desactivada (410) | Función temporal ya sin uso. |
| Trabajo `marketing-colchon-diario-0700-cdmx` | activo, `0 13 * * *` (7:00 CDMX) | Ejecutó con éxito cada día del 5 al 12 nov (revisado el 13). Registro en `tools/marketing/cron_colchon_0700.sql`. |
| Trabajo `marketing-colchon-vigia-0730-cdmx` | activo, `30 13 * * *` (7:30 CDMX) | Solo escribe si no hay corrida registrada. Ejecutó con éxito cada día del 5 al 12 nov. Registro en `tools/marketing/cron_vigia_0730.sql`. |
| Trabajo `marketing-analista-seguimientos-0745-cdmx` | activo, `45 13 * * *` (7:45 CDMX), jobid 39 | Programado el 5 nov con confirmación de Dirección; llama a `marketing-seguimientos` con el secreto leído de Vault por nombre (el valor no queda en el cron). Ejecutó con éxito cada día del 6 al 12 nov; sin seguimientos que responder. Registro en `tools/marketing/cron_analista_seguimientos_0745.sql`. Reversa: `select cron.unschedule('marketing-analista-seguimientos-0745-cdmx')`. |

Regla del colchón: días desde hoy (CDMX) hasta la última pieza programada pendiente y sin borrador por red; verde ≥ 14, amarillo 7–13, rojo < 7.

## Contenido de las tablas (13 nov 2026)
- 94 piezas (31 jul 2026 → 14 ene 2027); 121 resultados (sin cambios: la carga de resultados de Metricool sigue pendiente de Dirección); 57 filas de colchón; 19 informes diarios; 52 de bitácora; 25 de `mk_api_log`; 0 propuestas.
- Colchón de la última corrida real (12 nov): **19 días y verde en Instagram, Facebook y LinkedIn**. Baja un día cada día mientras no se programen piezas nuevas; el Vigilante abre caso cuando baje de 14.
- Casos: 9 en total, 6 abiertos y 3 cerrados, sin cambios desde el 3 nov. Abiertos: 1 investigación (Instagram, septiembre) y 5 «dato sospechoso» de LinkedIn. Los casos 7, 8 y 9 (colchón) se cerraron el 3 nov. Ningún caso `falla_monitoreo` abierto.
- Agentes: 4 de Marketing (`kind = 'system'`) y 21 consultables no archivados de kawiil-central. `agent_tasks` tiene 97 tareas en total, 19 de Marketing. El estado de la VM `kawiil-agents` y la actividad de esos agentes no se revisaron en esta actualización (el 4 nov no tenían latidos desde el 7 jun).
- Analista: 1 pregunta en `mk_consulta` (5 nov, respondida; marcó «cifras sin verificar» por un falso positivo ya corregido), 0 seguimientos.
- Carga del historial: `tools/marketing/carga_historial.sql`, organización `a0000000-0000-0000-0000-000000000001` («Kawiil Demo»). **Pendiente de Dirección: confirmar que es la organización de Kawiil MX.**
- Calendario nov 2026 – ene 2027: `tools/marketing/carga_calendario_nov2026_ene2027.sql` (ejecutado, verificado con `verificar_calendario_nov2026_ene2027.sql`).

## Agentes de Marketing en `agent_registry` (4 nov 2026; el Analista se sumó el 5 nov)
Migración `20261104015632_marketing_registrar_agentes` (aplicada con confirmación de Dirección). Tres filas `kind = 'system'` (el 5 nov se agregó el cuarto, el Analista; ver más abajo), estado `idle`, sin modelo de IA, solo lectura, en la organización global de agentes (`00000000-0000-0000-0000-000000000001`):

| Nombre | Se muestra como | Horario | Objetivo declarado |
|---|---|---|---|
| `marketing_vigilante` | Vigilante del colchón | todos los días 7:00 CDMX (`marketing-colchon`) | colchón de 14 días o más en las tres redes |
| `marketing_informe_diario` | Informe diario | todos los días 7:00 CDMX (`marketing-colchon`) | informe de faltantes cada día antes de las 7:30 |
| `marketing_vigia` | Vigía del colchón | todos los días 7:30 CDMX (`mk_vigia_colchon`) | ninguna corrida diaria falta sin un caso de falla abierto |

- **Registro de corridas (4 nov 2026):** `marketing-colchon` v11 deja una tarea del Vigilante y otra del Informe diario por corrida real, y el vigía actualiza su latido (todo bien) o deja una tarea con error (no corrió). Sin eventos en `ai_task_events` (nadie los vería por la política de lectura). Las tareas quedan en la organización global de los agentes y no llevan `conversation_id`, así que no generan notificaciones. Desde la corrida de las 7:00 CDMX del 5 nov registran todos los días: al 13 nov el Vigilante y el Informe diario suman 9 tareas completadas y 0 con error cada uno; el Vigía no tiene tareas porque solo escribe cuando falta una corrida (y no ha faltado ninguna). **Latido compartido (hallado el 12–13 nov):** los 25 agentes de `agent_registry` (consultables y de Marketing) reciben el mismo `last_heartbeat` al mismo instante cada ~30 min; no lo escribe ningún cron, función ni disparador de la base, así que viene del servicio `kawiil-agents` (señal de que la VM está encendida). Ese latido no dice si un trabajo de Marketing corrió: hacía que la oficina mostrara «Acaba de trabajar» en todos y habría ocultado una corrida faltante. Desde la corrección, `conLatidoPropio` (`src/lib/agentes/registro.ts`) sustituye ese latido compartido por la hora de la última tarea propia. Consecuencia: el Vigía, que cuando todo está bien solo deja latido y no tarea, aparece «Sin datos» hasta que su corrida deje tarea propia (propuesta pendiente de Dirección: que `mk_vigia_colchon` registre una tarea completada cada día).
- En la pantalla, los agentes de sistema se juzgan por su cadencia diaria (al día si corrieron en las últimas 26 h) y muestran su objetivo con «Cumple / No cumple»; ya no cuentan para la banda del servicio `kawiil-agents`.
- `kind = 'system'` los deja fuera de `list-agents` (solo ofrece los consultables): no salen en el selector del chat ni se instancian por cliente. `dispatch-to-agent` solo valida que el agente exista, así que una llamada directa a la API podría despachar una tarea a uno de ellos, que la VM no sabría atender; ninguna pantalla lo ofrece.
- El Revisor no se registra: todavía no existe.
- Reversa: `tools/marketing/rollback_registrar_agentes.sql` (borra solo esas 3 filas y se salta las que ya tengan tareas). Prueba: `tools/marketing/prueba_registrar_agentes_pglite.mjs`.

## Analista de resultados (fase 2, 5–6 nov 2026)
Agente con IA, **solo lectura** (`kind = 'system'`, `cadencia = bajo_demanda`). Responde cómo van las piezas (alcance, guardados, clics por red, formato y pilar), el colchón, el semáforo y los casos, citando fuente y fecha de corte. No publica ni cambia nada, no habla con Metricool ni conoce su token, y no tiene datos de anuncios ni de Google: lo dice cuando se le pregunta.
- **Cómo responde:** `marketing-agente` valida sesión y permiso (`mk_can_view`) y llama al modelo (`claude-sonnet-5-5`, configurable con `MARKETING_AGENTE_MODELO`; secreto `ANTHROPIC_API_KEY`, ya existente). Solo puede usar 10 herramientas de lista cerrada, todas por `mk_analista_datos` (colchón, resultados por semana/formato/pilar, semáforo, casos, informe de hoy, piezas próximas, reglas, cobertura). Máx. 60 filas por herramienta.
- **Verificación de cifras:** cada número de la respuesta (≥ 11, decimales, porcentajes y fechas ISO) debe aparecer en lo que leyó; si no, la respuesta se marca «Cifras sin verificar» y lista cuáles. Los números que el propio agente pide como parámetro (p. ej. «últimos 90 días») no cuentan (corregido en #498 tras la primera pregunta real).
- **Topes:** 30 preguntas por día y usuario y 1.500.000 tokens al mes por organización (`MARKETING_AGENTE_MAX_DIA`, `MARKETING_AGENTE_MAX_TOKENS_MES`). Al llegar, responde con el tope y lo registra.
- **Registro:** cada pregunta queda en `mk_consulta` (pregunta, respuesta, si se verificó, herramientas usadas con número de filas —nunca su contenido—, modelo, tokens y duración) y como tarea y latido del agente. Leen `mk_consulta` solo quienes pueden ver Marketing en su organización; escribe solo `service_role`.
- **Seguimientos:** una pregunta que el Analista responde sola, una vez, a diario o cada semana (`mk_seguimiento`; tope de 5 por usuario y 5 por ejecución; cuentan para el tope mensual). Se piden desde el panel («Dar seguimiento») y corren con el trabajo de las 7:45 CDMX (`marketing-seguimientos`); la respuesta aparece en el historial marcada «seguimiento». Si una corrida falla no se repite hasta el siguiente periodo y el fallo queda en el historial («Sin respuesta»). Solo panel: sin correo, Slack ni WhatsApp.
- **Estado al 13 nov:** 1 pregunta (5 nov), 0 seguimientos. Falta una pregunta de prueba con el arreglo de #498 y un seguimiento de prueba para ver su primera respuesta.
- **Código:** `supabase/functions/marketing-agente`, `marketing-seguimientos`, `_shared/analista.ts` (lógica pura y verificación) y `_shared/analista_servidor.ts` (modelo y herramientas); pruebas `_shared/analista*.test.ts` (invariantes del código: solo escribe `mk_consulta`, sin Metricool, secretos por nombre), `tools/marketing/prueba_analista_pglite.mjs` y `prueba_seguimientos_pglite.mjs`. Reversas: `tools/marketing/rollback_analista_datos.sql`, `rollback_analista_registro.sql`, `rollback_analista_seguimientos.sql`. Diseño: `docs/marketing-equipo-agentes-diseno.md` (secciones 12 y 13).

## Interfaz (`/marketing`)
Panel con colchón e informe de faltantes, calendario, casos, semáforo, reglas (valores vigentes e historial), estado de monitoreo y la pestaña **Agentes**. Acceso con permiso que falla cerrado. Todo de solo lectura.

La pestaña **Agentes** (la oficina y el Analista están en producción desde el 5 nov) tiene tres partes:
- **Oficina de agentes**: lienzo en pixel art propio con un personaje por agente de Marketing (Vigilante, Informe, Vigía y Analista). Estado real: trabaja si corrió en los últimos 30 min, descansa («z») entre corridas, «!» si hay error, atraso (más de 26 h sin correr) o meta sin cumplir, gris si no tiene corridas. Al elegir un agente: objetivo, cumplimiento y últimas corridas. **Al elegir al Analista** aparece su panel: caja de preguntas (hasta 500 caracteres; la respuesta se muestra con negritas y viñetas limpias, con pastilla de cifras verificadas o sin verificar y sus fuentes con fecha de corte), «Dar seguimiento» con frecuencia, lista de seguimientos (Pausar, Reanudar, Terminar) e historial de preguntas. Los otros agentes todavía no admiten preguntas ni tareas (fases siguientes, ver `docs/marketing-equipo-agentes-diseno.md`). El Analista es «bajo demanda»: se muestra «Disponible», no «atrasado».
- **Agentes de Marketing** (Vigilante, Informe diario, Vigía): tarjetas, línea de tiempo y flujo de un caso; usa `mk_agentes_estado()` y, sin ella, el horario previsto.
- **Agentes de kawiil-central** (#473, 3 nov 2026): lee `agent_registry` y `agent_tasks` con la sesión del usuario (RLS de lectura de autenticados ya existente; sin migración).
  - Banda del servicio `kawiil-agents` (la VM que corre en la Mac de Leo y escribe esas tablas): en línea si algún agente activo dio latido en las últimas 2 h; si no, «sin señal».
  - Tarjeta por agente: estado, último latido, última tarea, tareas completadas y con error con su porcentaje. Señales: en línea (latido ≤ 2 h), inactivo (≤ 7 días), sin señal (> 7 días), sin latido, atascado («trabajando» sin latido > 1 h) y archivado (oculto hasta pedirlo).
  - Tareas recientes (30 días, con «Ver todo el historial»), con filtros por agente y «solo con error».
  - Privacidad: de `agent_tasks` solo se piden `id, agent_id, task_type, status` y fechas; no se piden título, instrucciones, resultado ni mensaje de error. Una prueba lo comprueba.
  - No despacha tareas ni toca la VM. Quien opera esos agentes (no Marketing) es `kawiil-agents`; los agentes de Marketing están registrados aparte (`kind = 'system'`) y corren con `pg_cron` y funciones de Supabase.
  - Código: `src/components/marketing/agentesRegistroLogica.ts`, `AgentesRegistro.tsx`, hooks `useAgentesRegistro` y `useTareasAgentes`; pruebas en `src/test/marketingAgentesRegistro.test.tsx`.

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
- ~~Comprobar el registro de corridas~~: hecho (corridas automáticas del 5 al 12 nov registradas; el código con la pantalla de cumplimiento ya está en `main`).
- Entrega 2, paso 2 (simulacro de resultados): `marketing-resultados` v1 está desplegada (#530) y solo lee; no escribe datos. Falta que Dirección revise su reporte antes de aprobar la carga de resultados en `mk_resultado` y `mk_pieza_red` (`docs/marketing-entrega2-resultados.md`).
- Analista: hacer una pregunta de prueba con el arreglo de #498 (debe salir «Cifras verificadas») y crear un seguimiento de prueba («Una vez») para ver su respuesta después de las 7:45 CDMX.
- Vigía: registrar una tarea completada cada día (hoy solo deja latido, que la VM sobrescribe). Es una escritura en producción (cambio de `mk_vigia_colchon`/`mk_vigia_registra`): requiere confirmación de Dirección.
- Datos de anuncios y de Google: el Analista no los tiene. Decidir fuente (Metricool, Meta/LinkedIn Ads o CSV) antes de construir al Analista de anuncios.
- Siguientes agentes (Revisor, Estratega, Creativo) y el flujo de campañas: ver `docs/marketing-equipo-agentes-diseno.md`.
- Resumen semanal a Cerebro como entregable de «Kawiil MX»: falta confirmar cómo se autentica una función de Supabase contra Cerebro.
- Servicio `kawiil-agents`: el 4 nov no tenía latidos desde el 7 jun 2026; el 13 nov marca a los 25 agentes cada ~30 min (latido de las 01:05 UTC), así que la VM parece encendida. Confirmar con Dirección (módulo Agentes, otro chat).
- Rama `claude/marketing-reglas-detalle`: no se toca hasta que Dirección indique borrarla.
