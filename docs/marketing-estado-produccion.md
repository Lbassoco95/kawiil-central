# Marketing · Estado en producción (proyecto `qppfampapbxdgednkofc`)

Actualizado: 3 nov 2026 (después de fusionar #469, #471 y desplegar `mtg-recall-join`).

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

`20261103045435_fix_scheduled_recurring_tasks_no_cascade` está en el registro pero **no es de Marketing**: se aplicó fuera del repo y en `supabase/migrations/` hay un archivo marcador sin efecto para que `supabase db push` no aborte. Si el SQL real llega en otro PR, reemplazar el marcador (misma versión).

## Funciones y trabajos programados
| Pieza | Estado en producción | Notas |
|---|---|---|
| `marketing-metricool` | v6, `verify_jwt = false` | Conector de solo lectura con marca fija y lista cerrada. Incluye el modo «forma» (`operacion: "forma:<op>"`: solo campos, tipos y números permitidos; falla cerrado en un conector sin ese modo). El repo contiene exactamente este código. |
| `marketing-colchon` | v9 (código de la versión 5), `verify_jwt = false` | Se autentica con `x-marketing-secret`, lee Metricool solo por el conector. Un caso abierto por red mientras el colchón < 14 días; un único caso `falla_monitoreo` ante fallas. El repo contiene este código. |
| `marketing-metricool-perfiles` | v10, `verify_jwt = true`, desactivada (410) | Función temporal ya sin uso. |
| Trabajo `marketing-colchon-diario-0700-cdmx` | activo, `0 13 * * *` (7:00 CDMX) | Última corrida correcta: 3 nov 13:00 UTC. Registro en `tools/marketing/cron_colchon_0700.sql`. |
| Trabajo `marketing-colchon-vigia-0730-cdmx` | activo, `30 13 * * *` (7:30 CDMX) | Solo escribe si no hay corrida registrada. Última corrida correcta: 3 nov 13:30 UTC. Registro en `tools/marketing/cron_vigia_0730.sql`. |

Regla del colchón: días desde hoy (CDMX) hasta la última pieza programada pendiente y sin borrador por red; verde ≥ 14, amarillo 7–13, rojo < 7.

## Contenido de las tablas (3 nov 2026)
- 94 piezas (31 jul 2026 → 14 ene 2027) y 264 filas de pieza por red; 121 resultados; 15 reglas; 24 filas de colchón; 8 informes diarios; 27 de bitácora; 14 de `mk_api_log`; 0 propuestas.
- Casos: 9, todos abiertos. Caso 1 (investigación de Instagram, septiembre), casos 2–6 («dato sospechoso» de LinkedIn) y casos 7, 8 y 9 (colchón de 4 días en Instagram, Facebook y LinkedIn; uno por red, sin duplicados). Ningún caso `falla_monitoreo` abierto.
- Carga del historial: `tools/marketing/carga_historial.sql`, organización `a0000000-0000-0000-0000-000000000001` («Kawiil Demo»). **Pendiente de Dirección: confirmar que es la organización de Kawiil MX.**
- Calendario nov 2026 – ene 2027: `tools/marketing/carga_calendario_nov2026_ene2027.sql` (ejecutado, verificado con `verificar_calendario_nov2026_ene2027.sql`).

## Interfaz (`/marketing`)
Panel con colchón e informe de faltantes, calendario, casos, semáforo, reglas (valores vigentes e historial), estado de monitoreo y la pestaña **Agentes** (tarjetas, línea de tiempo y flujo; usa `mk_agentes_estado()` y, sin ella, el horario previsto). Acceso con permiso que falla cerrado. Todo de solo lectura.

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
- Rama `claude/marketing-reglas-detalle`: no se toca hasta que Dirección indique borrarla.
