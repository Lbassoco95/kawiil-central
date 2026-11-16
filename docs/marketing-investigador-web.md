# Marketing · Investigador web (preparado) — 15 y 16 nov 2026

Estado: **v1 (lectura) desplegada el 16 nov (PR #551) sin migración, sin fuentes y sin trabajo programado. v2 (descubrimiento de fuentes) construida y probada en el repo, sin desplegar.** Nada del Investigador escribe todavía en producción.
Diseño de origen: `docs/marketing-equipo-agentes-diseno.md` §14.3. Decisión de Dirección (15 nov): preparar el Investigador como agente que «esté buscando».

## Qué hace
Lee, solo con `GET` y por `https`, una **lista cerrada** de páginas y fuentes de noticias que escribe Dirección, y deja **hallazgos** en el panel:
- **Sitio propio y competencia (páginas):** compara el texto de la página con la última lectura (huella). Si cambió, le pide al modelo un resumen de *qué cambió* respecto al resumen anterior (máx. 3 oraciones). Si el cambio no es de fondo (fechas, contadores, menús), no deja hallazgo.
- **Noticias (feeds RSS/Atom):** toma las notas nuevas (título, enlace, fecha y un extracto corto), filtradas por los temas que Dirección ponga (por ejemplo PLD, SAT, CNBV). No usa el modelo.
- Primera lectura de una página: guarda la «base» (huella y resumen) **sin** crear hallazgo. Primera lectura de un feed: solo notas de los últimos 7 días.

## Salvaguardas (cada una tiene prueba)
| Riesgo | Qué lo impide |
|---|---|
| Que lea sitios que no son | Solo los de `mk_fuente_web` (la escribe Dirección; los usuarios solo leen). Solo `https`, sin usuario/contraseña, solo puerto 443, sin IP ni direcciones internas (`localhost`, `.local`, `.internal`). |
| Redirecciones a otro sitio | Solo sigue redirecciones del mismo sitio, a `https`, máx. 3. |
| Páginas enormes o lentas | Tope de 1 MB por página, 8 s por sitio, 100 s por corrida, 30 fuentes, 10 resúmenes y 40 hallazgos por corrida. |
| Sitios que no quieren robots | Lee `robots.txt` de cada sitio y respeta `Disallow`/`Allow`; si lo prohíbe, no pide la página y lo anota. |
| **Una página con instrucciones escondidas** (inyección) | El modelo **no tiene herramientas**, el prompt declara la página como dato no confiable y su salida se limpia (sin enlaces ni marcas, máx. 600 caracteres) antes de guardarse. El panel pinta todo como texto y solo abre enlaces `https`. |
| Derechos de autor | No se guarda el texto de la página: solo resumen corto, título, enlace y fecha. |
| Escribir donde no debe | Por omisión es **vista previa** (no llama al modelo ni escribe nada). Escribir exige `escribir: true`. La función solo toca `mk_fuente_web` (última lectura, huella, resumen), `mk_hallazgo_web` y el registro de corridas (`mk_registrar_corrida`); una prueba lo verifica en el código. |
| Duplicados | `mk_hallazgo_web` es único por (fuente, huella): repetir una corrida no duplica. |
| Avisos | Solo panel: sin correo, Slack ni WhatsApp. |

## Qué se agregó en el repo
- `supabase/functions/_shared/investigador.ts` (lógica pura) y `investigador.test.ts` (22 pruebas).
- `supabase/functions/marketing-investigador/index.ts` (secreto propio `x-marketing-secret`, sin JWT; entrada en `supabase/config.toml`).
- `supabase/pendientes/20261115220000_marketing_investigador.sql` (tablas `mk_fuente_web` y `mk_hallazgo_web`, RLS de solo lectura, registro del agente `marketing_investigador`, y su alta en `mk_registrar_corrida` / `mk_latido_agente`), reversa `tools/marketing/rollback_investigador.sql` y prueba `tools/marketing/prueba_investigador_pglite.mjs` (5 pruebas).
- `tools/marketing/cron_investigador_0800.sql`: el trabajo diario de las 8:00 CDMX, **sin programar**.
- Pantalla: el Investigador aparece en la oficina (zona Análisis) y su panel muestra «Qué vigila» y «Qué encontró». Si no hay fuentes, lo dice.
- `llmAnthropic` (`_shared/analista_servidor.ts`) omite `tools` cuando no hay herramientas (la API puede rechazar una lista vacía); con herramientas queda igual que hoy.


## Descubrimiento de fuentes (v2, 16 nov)
Pedido de Dirección: que el agente **busque y arme** la lista de fuentes. Decisión: **el agente propone, una persona aprueba.**
- **Qué hace** (`{"modo":"descubrir"}`): usa la búsqueda web de Anthropic para encontrar competidores (software de PLD, cumplimiento y contabilidad para empresas en México) y fuentes de noticias (DOF, SAT, UIF, CNBV, medios del sector). El modelo devuelve candidatos y **cada uno se verifica por separado**: https, sin IP ni direcciones internas, `robots.txt`, un `GET` que responda, que la página tenga texto y, en noticias, que el feed RSS/Atom anunciado exista y traiga notas (si lo trae, se propone el feed).
- **Qué guarda:** una **propuesta** en `mk_fuente_web` (`estado = 'propuesta'`, `activa = false`, `origen = 'agente'`, con su motivo y la fecha de verificación). Lo que no se pudo verificar se descarta y el reporte dice por qué. No repropone nada que ya exista (activa, propuesta o rechazada); máx. 15 propuestas por búsqueda y 2 por sitio.
- **Por qué no se activa sola:** si el agente pudiera activar sus fuentes, una página con instrucciones escondidas podría hacerlo leer sitios de un atacante. Está impedido en tres capas: (1) el código nunca escribe `activa`/`estado = 'activa'`/`aprobada_at` (una prueba lo verifica y se comprobó que falla si se cambia), (2) la lectura solo toma `estado = 'activa'`, (3) la base rechaza una fuente del agente activa sin `aprobada_at`, y solo `service_role` puede escribir.
- **Aprobar o rechazar:** por ahora lo hace Claude con tu confirmación (`UPDATE … SET estado='activa', activa=true, aprobada_at=now()` o `estado='rechazada'`, que conserva la fila para no volver a proponerla). Un botón en el panel queda como paso siguiente.
- **Vista previa:** `modo: descubrir` sin `escribir: true` busca y verifica, pero no guarda nada. **Sí gasta tokens** (la búsqueda es el trabajo).
- **La búsqueda es la parte que no se pudo probar contra la API real:** no hay llave ni red en la sesión de desarrollo. Está probada con la API simulada; la primera corrida en vista previa es la prueba real. Si el modelo o la cuenta no tienen habilitada la herramienta de búsqueda web, la función responde error sin escribir nada; la versión de la herramienta se cambia con el secreto opcional `MARKETING_BUSQUEDA_HERRAMIENTA` (por defecto `web_search_20250305`).
- **Frecuencia:** una búsqueda inicial a mano y, si Dirección lo confirma, una mensual (`tools/marketing/cron_investigador_descubrir_mensual.sql`, sin programar).
- **Pantalla:** el panel del Investigador muestra «Fuentes que propone (esperan tu aprobación)» con motivo y enlace https.

## Tu sitio
Dirección (16 nov): el sitio de Kawiil es **kawiil.mx**. Queda como fuente de tipo «sitio propio» (`https://kawiil.mx/`), **por cargar con tu confirmación** junto con la migración; el agente la compara contra la última lectura. Desde la sesión de desarrollo no se puede abrir el sitio (la red lo bloquea), así que no se verificó qué páginas tiene; la primera vista previa de lectura lo dirá. Si quieres vigilar secciones concretas (precios, blog), dime sus direcciones.

## Lo que necesito de Dirección
- **Hecho:** el sitio propio (`kawiil.mx`) y la decisión de que el agente busque las demás fuentes.
- **Pendiente:** secciones concretas de tu sitio, si quieres vigilar más que la página principal.
- **Sin pedir a Dirección:** competidores y noticias los busca el agente y tú apruebas.

## Lista de escrituras en producción (cada una con tu confirmación, una por una)
| # | Qué | Dónde | Reversa |
|---|---|---|---|
| 1 | Aplicar `marketing_investigador` (tablas vacías con estado/origen/aprobación, agente, funciones de registro). Guardar el archivo en `supabase/migrations/` con la versión real. | Base de datos | `tools/marketing/rollback_investigador.sql` |
| 2 | Desplegar `marketing-investigador` v2: lo hace el flujo al fusionar el PR, porque cambia la carpeta de la función (los archivos nuevos de `_shared` viajan con ella; ninguna otra función cambia) | Edge Functions | Redesplegar la v1 (`git revert` del PR) |
| 3 | Cargar `https://kawiil.mx/` como fuente propia (activa) | Base de datos | `delete from mk_fuente_web where …` |
| 4 | **Búsqueda en vista previa** (`modo: descubrir`, no guarda; gasta tokens): ves qué propondría | — | — |
| 5 | Búsqueda con `escribir: true`: guarda las propuestas (inactivas) | Base de datos | `delete from mk_fuente_web where origen='agente' and estado='propuesta'` |
| 6 | **Aprobar** las propuestas que elijas (`estado='activa'`, `activa=true`, `aprobada_at`) | Base de datos | volver a `propuesta` |
| 7 | **Vista previa de lectura** de las fuentes activas (no escribe) | — | — |
| 8 | Primera lectura con `escribir: true` (base de cada página; las noticias dejan hallazgos; usa el modelo, máx. 10 resúmenes) | Base de datos + modelo | Borrar hallazgos y limpiar huellas |
| 9 | Programar la lectura diaria de las 8:00 (`cron_investigador_0800.sql`) | pg_cron | `cron.unschedule('marketing-investigador-0800-cdmx')` |
| 10 | (Opcional) Programar la búsqueda mensual (`cron_investigador_descubrir_mensual.sql`) | pg_cron | `cron.unschedule('marketing-investigador-descubrir-mensual-0830-cdmx')` |

La corrida con `escribir: true` usa el modelo (hasta 10 resúmenes por corrida, de entrada ~12 000 caracteres cada uno).

## Siguientes pasos (no incluidos)
- Que el **CMO lea los hallazgos** (nueva herramienta de solo lectura en `mk_analista_datos`; su prompt debe tratarlos como datos, no instrucciones).
- Botones en el panel para aprobar, rechazar o quitar fuentes sin SQL (hoy lo hace Claude con tu confirmación).
- Marcar hallazgos como vistos.
