# Comunicación interna — implementación alterna descartada y revertida (16 nov 2026)

**Estado final:** hay **una sola** «Comunicación interna», la de `main` (#561): agente `marketing_comunicacion_interna`, tabla `aviso_equipo`, función `comunicacion-interna`; ver `docs/comunicacion-interna.md`. Esta nota solo documenta la alternativa que se construyó en paralelo y se revirtió.

## Qué pasó
Dirección pidió un agente de marketing para la comunicación interna (por ejemplo, «el lunes 16 no se trabaja») con un aviso al abrir el sistema, **solo dentro del sistema** y **aprobado por Dirección**. Se construyó **dos veces a la vez** en dos sesiones:
- **La de `main`** (#561): tabla nueva `aviso_equipo`, función propia `comunicacion-interna`.
- **La alterna (esta)**: ampliaba `internal_comunicados` (estado, vigencia, «avisar al entrar», aprobación) y el agente `marketing_comunicacion` vivía en `marketing-agente`.

Las dos migraciones se aplicaron en producción con 2 segundos de diferencia (`20261116221332` la de `main`, `20261116221334` la alterna) y quedaron **dos agentes con el mismo nombre visible**. Dirección pidió dejarlo correcto; como la de `main` ya estaba fusionada, **se revirtió la alterna**. Estaba vacía (0 comunicados, 0 consultas, 0 tareas), así que no se perdió ningún dato.

## Versiones de migración en producción (y por qué hay archivos aquí)
| Versión | Qué es | En `main` |
|---|---|---|
| `20261116221332` | la de `main` (aviso_equipo) | su archivo |
| `20261116221334` | **la alterna** (producción guarda su SQL) | un archivo con el mismo número pero **otro contenido** (copia de la de `main`): solo cuenta el número para `db push` |
| `20261116223934` | corrección de las listas de agentes de la alterna | este archivo |
| `20261116225413` | **reversión de la alterna** (defensiva, idempotente, probada) | este archivo |

Producción registra las cuatro; `db push` aborta si falta alguna en el repo. El SQL real de la alterna, tal como se aplicó, está en `tools/marketing/alternativa_comunicacion_interna/`.

## Un error mío que salió de esto
La migración alterna comprobaba «¿ya está en la lista de agentes?» con una búsqueda de texto, y el nombre del agente de la otra sesión (`marketing_comunicacion_interna`) **contiene** el mío (`marketing_comunicacion`): no agregó mi agente a `mk_registrar_corrida` / `mk_latido_agente`. La corrección comparaba el nombre exacto y la reversión también (solo quita `marketing_comunicacion`, nunca al otro). Lección: al ampliar listas de nombres, comparar el nombre exacto entre comillas.

## Lo que se podría rescatar de la alterna (no está en `main`)
- **Aprobación exigida por la base:** un comunicado redactado por el agente no puede quedar publicado sin `aprobado_at`, que solo pone una función reservada a Dirección (`marketing_decidir`).
- **Vigencia por fechas en el Hub**, con aviso al abrir el sistema una vez por persona al día (por navegador).
- **Tarjeta de propuesta** en la oficina con «Guardar como borrador» y «Aprobar y publicar» con confirmación.
Todo ese código sigue en el historial de la rama `claude/vigilant-albattani-tdz5et` (commits del 16 nov, «Comunicación interna»), con sus pruebas (Vitest, Node y PGlite).

## Prueba de la reversión
`tools/marketing/prueba_revertir_comunicacion_duplicada_pglite.mjs`: tras revertir, el estado completo (agentes, columnas, políticas, funciones, listas, `CHECK` y permisos) es igual al de antes; no se toca al agente de la otra sesión; es segura en una base donde la alterna nunca existió; y repetirla no cambia nada.
