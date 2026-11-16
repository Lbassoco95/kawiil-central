# Marketing · Comunicación interna (avisos al equipo) — migración aplicada, código sin fusionar (16 nov 2026)

Estado: **migración aplicada en producción el 16 nov (`20261116221334`) y corregida (`20261116223934`); el código (agente, aviso y Hub) está en la rama y NO se ha fusionado ni desplegado.**

> **Duplicado pendiente de decidir.** Otra sesión construyó en paralelo su propio «Comunicación interna» (rama `claude/comunicacion-interna-avisos`: agente `marketing_comunicacion_interna`, tabla nueva `aviso_equipo`, función `comunicacion-interna`) y aplicó su migración 2 segundos antes que la mía (`20261116221332`). Hoy producción tiene **los dos agentes con el mismo nombre visible** y dos conjuntos de tablas/funciones vacíos. Hay que elegir uno (o fusionarlos) antes de fusionar cualquiera de los dos PR. Además las dos ramas traen un archivo con la versión `20261116221334` y distinto contenido: solo puede quedar uno en `main`.
>
> **Error mío ya corregido:** mi migración comprobaba «¿ya está en la lista?» con una búsqueda de texto que coincidió con el nombre del otro agente, y no agregó el mío a `mk_registrar_corrida` / `mk_latido_agente`. `20261116223934_marketing_comunicacion_listas_agentes.sql` lo agrega comprobando el nombre exacto y sin tocar al otro; la prueba reproduce el error y falla si vuelve.
Pedido de Dirección (16 nov): un agente de marketing para la **comunicación interna** del equipo de Kawiil (por ejemplo, «el lunes 16 no se trabaja») y que ese día, a quien entre al sistema, le aparezca un aviso.
Decisiones de Dirección: **el equipo se entera solo dentro del sistema** (aviso al abrirlo y Hub) y **Dirección aprueba cada comunicado**.

## Cómo funciona
1. **Hablas con «Comunicación interna»** en la oficina de agentes (franja «Dirección», junto al CMO): «el lunes 16 no se trabaja, avísale al equipo».
2. El agente **redacta y propone**: te contesta con una frase y una **tarjeta** con título, mensaje, vigencia (por ejemplo, desde hoy hasta ese lunes) y si saldrá como aviso al abrir el sistema. Si falta algo esencial, hace **una** pregunta; si ya existe un aviso parecido, te lo dice.
3. **Tú decides** en la tarjeta: «Guardar como borrador» (se revisa y publica luego en Hub → Comunicados) o «Aprobar y publicar» (pide confirmación: «¿Publicarlo para todo el equipo?»).
4. **El equipo lo ve solo dentro del sistema**: durante la vigencia, al abrir Kawiil aparece un aviso («Aviso para el equipo», con la fecha en español y el mensaje), **una vez por persona al día** en ese navegador, con botón «Entendido». Además queda en Hub → Comunicados.

Quién es el «técnico»: no hace falta un agente que edite código por cada fecha. La pieza técnica se construye **una vez** (este trabajo) y después cada aviso es solo un registro con fechas y mensaje; el agente no cambia el sistema, solo propone ese registro.

## Qué agente es y qué NO puede hacer
- Solo lee y propone. **No publica, no envía, no escribe en la base**: el agente no tiene ninguna herramienta de escritura. Quien guarda el borrador o lo publica es la persona (con la sesión de Dirección), y la base lo vuelve a comprobar.
- **No hay correo, Slack ni WhatsApp**: el equipo lo ve solo en el sistema.
- No usa las herramientas de resultados ni la verificación de cifras (escribe fechas, no cifras de la base). Su única herramienta es leer los comunicados que ya existen (los publicados y **tus** borradores, no los de otras personas).
- El prompt lleva la **fecha de hoy** (hora de Ciudad de México) para resolver «el lunes 16» o «mañana». Esfuerzo bajo del modelo.

## Qué se construyó (repo)
| Pieza | Dónde |
|---|---|
| Migración (sin aplicar): `internal_comunicados` gana estado, origen, vigencia, «avisar al entrar» y aprobación; lectura solo de lo publicado para el equipo; funciones `ic_crear_borrador`, `ic_publicar`, `ic_archivar`, `ic_descartar_borrador` (solo Dirección); agente `marketing_comunicacion` y su alta en `mk_consulta`, `mk_registrar_corrida` y `mk_latido_agente` | `supabase/migrations/20261116221334_marketing_comunicacion_interna.sql` |
| Reversa y prueba contra Postgres en memoria (8 pruebas) | `tools/marketing/rollback_comunicacion_interna.sql`, `tools/marketing/prueba_comunicacion_interna_pglite.mjs` |
| Agente en la función existente `marketing-agente` (prompt, fecha de hoy, herramienta de lectura, sin verificación de cifras) | `_shared/analista.ts`, `_shared/analista_servidor.ts`, `marketing-agente/index.ts` |
| Aviso al entrar (montado en `AppLayout`) | `src/components/shared/AvisoAlEntrar.tsx`, `src/lib/comunicados.ts` |
| Oficina: personaje, panel y tarjeta de propuesta | `src/components/marketing/OficinaAgentes.tsx`, `oficinaAgentesLogica.ts` |
| Hub → Comunicados: estado, vigencia, Publicar / Descartar / Retirar y fechas en el formulario | `src/pages/Hub.tsx`, `src/components/hub/ComunicadoItem.tsx` |
| Acceso a datos | `src/lib/comunicadosApi.ts`, `src/hooks/useInternalDespacho.ts` |

## Seguridad (cada punto tiene prueba)
- **Un comunicado del agente no puede quedar publicado sin aprobación:** la base exige `aprobado_at`, que solo pone `ic_publicar()`, y esa función exige el permiso de decidir en Marketing (`marketing_decidir`). Se comprobó que la prueba falla si se quita la restricción o el permiso.
- **El equipo no ve borradores ni retirados:** en producción `internal_comunicados` tiene **dos** políticas de lectura que se suman; la migración reemplaza las dos por una que solo muestra lo publicado (admin/manager y Dirección ven todo).
- **Lo que ya existe no cambia:** los comunicados actuales (y los que publiquen personas con el formulario de siempre) quedan «publicado», de origen «persona», sin vigencia. Hoy la tabla está vacía.
- **Texto no confiable:** el mensaje que propone el modelo se valida (largos, fechas reales, vigencia de a lo más un año) y se pinta siempre como texto, nunca como HTML.
- **Las listas de agentes se amplían leyendo la definición vigente** (no copiando una lista a mano), para no borrar a otro agente que otra migración agregue; la prueba lo reproduce con un agente «extra».
- **No bloquea el acceso:** el aviso informa, no impide entrar ni trabajar.

## Límites que conviene saber
- «Una vez al día» se recuerda **por navegador**: en otro equipo o navegador, la primera vez del día vuelve a salir.
- El aviso solo aparece a quien **abre** el sistema ese día. No avisa fuera del sistema (decisión de Dirección).
- Antes de aplicar la migración, la pantalla no muestra nada y el Hub funciona como siempre (la consulta falla en silencio).

## Lista de escrituras en producción (cada una con tu confirmación)
| # | Qué | Dónde | Reversa |
|---|---|---|---|
| 1 | ✅ **Hecho el 16 nov** (`20261116221334`, y su corrección `20261116223934`): columnas y restricciones, política de lectura, funciones `ic_*`, agente, listas de agentes. | Base de datos | `tools/marketing/rollback_comunicacion_interna.sql` (borra lo redactado con el agente; no toca al agente de la otra sesión) |
| 2 | Fusionar el PR (**después de decidir cuál «Comunicación interna» se queda**): despliega `marketing-agente` y `marketing-seguimientos` y la pantalla (Vercel) | Edge Functions + app | `git revert` del PR |
| 3 | Usarlo: hablar con el agente, revisar la tarjeta y aprobar. No requiere otra escritura mía. | — | Retirar el aviso desde Hub («Retirar») |

Antes de aplicar se verificó en producción (solo lectura): `internal_comunicados` vacía y con las 8 columnas esperadas, las dos políticas de lectura, las funciones auxiliares de RLS, y las listas de agentes de `mk_registrar_corrida`, `mk_latido_agente` y `mk_consulta`.
