# Marketing · Vista «Agentes» (3 nov 2026) — solo lectura. **Construida en el repo**; falta aplicar la función `mk_agentes_estado` (migración en `supabase/pendientes/`)

Objetivo: dentro de `/marketing`, una pestaña **Agentes** que muestre, por agente, su última corrida, resultado, próxima ejecución y si falló; una línea de tiempo con lo que hizo y el caso al que se refiere; y el flujo caso → Revisor → propuesta → decisión de Dirección, mostrando solo los agentes que existen. Todo sale de la bitácora y los casos que ya existen; la vista no escribe ni llama a Metricool.

## 1. Qué existe hoy (verificado en producción)
- Bitácora `mk_bitacora` (lectura para quien tiene el permiso de Marketing): `vigilante` (17 filas: `colchon` 8, `caso_colchon` 9), `informe_diario` (8), `sistema` (2: carga histórica y consulta de perfiles). **`revisor`: 0 filas.**
- Casos `mk_caso`: 9 (colchón 3, dato sospechoso 5, investigación 1), todos abiertos. Propuestas `mk_propuesta`: 0. Decisiones `mk_decision`: 0. Experimentos: 0.
- Trabajos programados: `marketing-colchon-diario-0700-cdmx` (7:00) y `marketing-colchon-vigia-0730-cdmx` (7:30). El vigía **no escribe nada cuando todo está bien** (decisión de Dirección), así que su «última corrida» no está en la bitácora: sale de la ejecución del trabajo.

## 2. Agentes que se muestran (catálogo + datos)
Un agente aparece **solo si existe**: tiene filas en la bitácora o un trabajo programado. Hoy: Vigilante del colchón, Informe diario y Vigía de las 7:30 (agente `sistema`). **El Revisor no aparece** (no hay corridas, ni propuestas) hasta que escriba su primera fila; Dirección aparece como quien decide, no como agente automático.
| Tarjeta | Última corrida | Resultado | Próxima ejecución | Falló |
|---|---|---|---|---|
| Vigilante | última fila `vigilante/colchon` | su texto («instagram 4 rojo; …; 3 actualizados») | 7:00 siguiente | si el texto dice «falla de lectura» o «N errores», o si no corrió |
| Informe diario | última fila `informe_diario/informe` | «N faltantes, N con error, N con estado desconocido» | con el Vigilante (7:00) | igual regla; además si falta el informe del día |
| Vigía 7:30 | última ejecución del trabajo | «Sin novedad» o la fila `SIN CORRIDA…` | 7:30 siguiente | si su fila dice SIN CORRIDA o el trabajo falló |
**Falló** también se marca cuando el agente debía correr y no hay registro (pasada su hora + 30 min), y muestra el enlace al caso `falla_monitoreo` abierto.
**Próxima ejecución:** se calcula a partir del horario del trabajo (expresión cron en UTC → hora de Ciudad de México). Para leer el horario y el estado real del trabajo (activo, pausado) hace falta una **función de solo lectura** nueva (una migración; escritura por separado). Sin ella, el MVP usa un catálogo fijo en el código («todos los días 7:00») y no puede avisar si alguien pausa el trabajo.

## 3. Línea de tiempo
Una lista por día, la más reciente arriba: hora · agente · qué hizo · resultado · **caso al que se refiere** (`#7 Colchón bajo · Instagram`, con enlace a la pestaña Casos), tomados de `mk_bitacora` unida a `mk_caso` por `caso_id`. Filtros: agente, caso, solo fallas. Por defecto 7 días, con «ver más». Las filas de corrida (sin caso) se agrupan por día para no saturar. Texto legible: la acción (`caso_colchon` → «caso de colchón») y el resultado tal como lo escribió el agente. Nunca se muestran datos de publicaciones (la bitácora no los contiene).

## 4. Flujo caso → Revisor → propuesta → decisión
Una franja horizontal con **conteos reales**, solo con los pasos que existen:
`Casos` (abiertos / en investigación / en decisión / cerrados) → `Revisor` *(se oculta mientras no haya filas del Revisor ni propuestas)* → `Propuestas` (pendiente / aprobada / rechazada / ajuste solicitado) → `Decisión de Dirección` (aprobadas, rechazadas, ajustes).
Hoy mostraría: 9 casos abiertos; sin Revisor, sin propuestas y sin decisiones. Cada número abre la lista correspondiente. Cuando exista el Revisor, el paso aparece solo, sin cambiar la vista. El botón «Decidir» sigue siendo de la pestaña Casos y solo para quien tenga `marketing_decidir` (no se mueve ni se duplica aquí).

## 5. Datos y límites
- Fuentes: `mk_bitacora`, `mk_caso`, `mk_propuesta`, `mk_decision` (todas con política de lectura para el permiso de Marketing). Opcional: función de lectura del estado de los trabajos (migración, por confirmar).
- Sin escrituras, sin llamadas a Metricool, sin textos de publicaciones. Cualquier cambio de datos va por su propia confirmación.
- Una consulta por bloque, caché de 3 minutos como el resto del módulo; el reloj de «próxima ejecución» se refresca cada minuto.
- Pruebas previstas: cálculo de «falló / no corrió», próxima ejecución desde el horario (incluida la zona horaria), qué agentes aparecen (con y sin Revisor), el flujo con conteos de 0 y con datos, y la línea de tiempo con los datos reales de hoy como ejemplo.

## 6. Diseño visual (boceto)
```
Agentes                                           [Solo fallas ▢]
┌ Vigilante del colchón ─────┐ ┌ Informe diario ───────────┐ ┌ Vigía 7:30 ────────────┐
│ ● Correcta · hoy 7:00      │ │ ● Correcta · hoy 7:00      │ │ ● Sin novedad · 7:30    │
│ instagram 4 rojo; …        │ │ 4 faltantes, 0 con error   │ │ Trabajo activo          │
│ Próxima: mañana 7:00       │ │ Próximo: mañana 7:00       │ │ Próxima: mañana 7:30    │
└────────────────────────────┘ └────────────────────────────┘ └─────────────────────────┘
Flujo:  Casos 9 abiertos  →  Propuestas 0  →  Decisión de Dirección 0     (el Revisor aparece cuando exista)
Línea de tiempo
 Hoy   7:00  Vigilante · caso #7 actualizado en Instagram: 5 → 4 días        [#7 Colchón bajo · Instagram]
 Hoy   7:00  Informe diario · 4 faltantes, 0 con error, 0 desconocidos
 2 nov 23:27 Vigilante · corrida manual: 3 casos actualizados
```
