# Marketing · Investigador web (preparado, sin aplicar ni desplegar) — 15 nov 2026

Estado: **construido y probado en el repo. No se escribió nada en producción, no se desplegó la función y no hay trabajo programado.**
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

## Lo que necesito de Dirección
La lista de fuentes empieza **vacía**. Para que lea algo:
1. **Tu sitio:** dirección(es) exacta(s) de las páginas a vigilar.
2. **Competidores:** nombre y dirección de las páginas (inicio, precios, blog…).
3. **Noticias:** fuentes con feed RSS/Atom (por ejemplo DOF, SAT, CNBV; si no tienen feed, se buscan alternativas) y los **temas** para filtrar.
No inventé ninguna dirección: cada una la escribes tú.

## Lista de escrituras en producción (cada una con tu confirmación, una por una)
| # | Qué | Dónde | Reversa |
|---|---|---|---|
| 1 | Aplicar `marketing_investigador` (tablas vacías, agente, funciones de registro). Guardar el archivo en `supabase/migrations/` con la versión real. | Base de datos | `tools/marketing/rollback_investigador.sql` |
| 2 | Desplegar la función `marketing-investigador` (el flujo lo hace al fusionar el PR, sin tocar `_shared`) | Edge Functions | Borrar la función |
| 3 | Cargar tus fuentes en `mk_fuente_web` (con tu lista exacta) | Base de datos | `delete from mk_fuente_web where …` |
| 4 | **Vista previa** (no escribe): lee y dice qué detectaría | — | — |
| 5 | Primera corrida con `escribir: true` (guarda la base de cada página; las noticias dejan hallazgos) | Base de datos + modelo (tokens) | Borrar hallazgos y limpiar huellas |
| 6 | Programar el trabajo de las 8:00 (`cron_investigador_0800.sql`) | pg_cron | `cron.unschedule('marketing-investigador-0800-cdmx')` |

La corrida con `escribir: true` usa el modelo (hasta 10 resúmenes por corrida, de entrada ~12 000 caracteres cada uno).

## Siguientes pasos (no incluidos)
- Que el **CMO lea los hallazgos** (nueva herramienta de solo lectura en `mk_analista_datos`; su prompt debe tratarlos como datos, no instrucciones).
- Pantalla para que Dirección agregue o quite fuentes sin SQL.
- Marcar hallazgos como vistos.
