# Marketing · Equipo de agentes: verlos, dejarles tareas, preguntarles y diseñar campañas (diseño, sin implementar)

Estado (5 nov 2026): **fase 1 construida en el repo y probada, sin desplegar** (la oficina con los 3 agentes que ya existen, solo lectura). El resto es diseño. No se ha escrito nada en producción. Maqueta de todo el equipo: `docs/maquetas/oficina-agentes-marketing.html` (datos de ejemplo, claramente marcada).

Fase 1 (código): `src/components/marketing/OficinaAgentes.tsx` (lienzo, lista accesible y panel), `oficinaAgentesLogica.ts` (qué estado se dibuja según los datos reales), integrada arriba de la pestaña Agentes de `/marketing`. Los archivos de lógica llevan el sufijo `Logica` (`agentesLogica.ts`, `agentesRegistroLogica.ts`, `oficinaAgentesLogica.ts`) para que no haya pares de nombres que solo difieran en mayúsculas con los componentes (`Agentes.tsx`, `AgentesRegistro.tsx`, `OficinaAgentes.tsx`), que pueden resolverse mal en sistemas de archivos que no distinguen mayúsculas. 17 pruebas nuevas en `src/test/marketingOficina.test.tsx`.

## 1. Qué pidió Dirección
1. Ver a los agentes de Marketing **de forma gráfica**, como en el proyecto de GitHub.
2. **Dejarles tareas y preguntarles**: cómo va el análisis, cómo se ha visto la mejora de los anuncios.
3. Empezar a **diseñar campañas** con agentes que ayuden a hacerlo correctamente.

## 2. Lo que se vio en Pixel Agents (README y estructura del repositorio, MIT)
- **Oficina en Canvas 2D** (React 19 + Vite, carpeta `webview-ui/`), con pathfinding y una máquina de estados por personaje. Cada agente es un personaje que camina a su escritorio y se sienta; hay mascotas y un editor de la oficina (suelos, paredes, muebles, alfombras, **Áreas** con nombre, importar/exportar el layout en JSON).
- **Estados visibles:** escribiendo (edita archivos), leyendo (busca), ejecutando comandos, y **burbujas** cuando espera input o un permiso; sonidos suaves opcionales al terminar un turno o pedir permiso.
- **Cómo se le dan tareas a un agente allí:** no hay chat. Se **lanza un agente de Claude Code en una carpeta («Directory»)** y el personaje se sienta en el Área asignada; la terminal embebida es la vía de conversación. La asignación por tablero aparece solo como visión de futuro.
- **De dónde sacan los datos:** eventos de hooks de Claude Code o, de respaldo, transcripciones en `~/.claude/projects/`, normalizados en un modelo común `AgentEvent`; `HookProvider` es el punto para otras herramientas.
- **Arte:** personajes «basados en» el paquete *Metro City* de JIK-A-4 (itch.io); la licencia MIT cubre el código, **no consta la licencia del arte**.

**Qué adoptamos** (la idea, no el código): oficina con zonas, un personaje por agente, estado → animación, burbujas de espera, panel al seleccionar. **Qué cambiamos:** nuestros agentes escriben en Supabase (no son sesiones de Claude Code) y sí queremos conversar y dejar tareas desde la misma pantalla. **Qué no copiamos:** sprites ni muebles (arte propio, ya dibujado en la maqueta) hasta confirmar licencia.

## 3. Qué hay hoy en Marketing
| Agente | Tipo | Estado |
|---|---|---|
| Vigilante del colchón, Informe diario, Vigía | **Deterministas** (Edge Function + pg_cron). No usan IA. | En producción, dejan tarea y latido en el registro (desde el 4 nov). |
| Revisor | Con IA | Planeado en la entrega 4; no existe. |
| Propuestas, decisiones, experimentos | Tablas `mk_propuesta`, `mk_decision`, `mk_experimento` | Ya existen (vacías). Permiso separado para decidir (`marketing_decidir`). |

Importante: **hoy ningún agente de Marketing razona ni conversa.** Para «preguntar cómo va el análisis» o «diseñar campañas» hacen falta agentes con IA.

## 4. El equipo propuesto
| Agente | Qué hace | Datos que lee | Estado |
|---|---|---|---|
| Vigilante, Informe diario, Vigía | Monitoreo (ya existen) | Metricool vía conector de solo lectura | Producción |
| **Analista de resultados** | Responde «cómo va»: alcance, guardados, clics por pilar, formato, horario y red; compara semanas; explica el semáforo | `mk_resultado`, `mk_calibracion`, `mk_colchon`, `mk_pieza*`, casos | Propuesto |
| **Analista de anuncios** | Mide la mejora de los anuncios (costo por resultado antes y después de cada ajuste) | **Sin fuente hoy** (ver 6) | Propuesto, bloqueado por datos |
| **Estratega de campañas** | Propone 2–3 enfoques con objetivo, audiencia, calendario y qué medir, respaldados por lo que ha funcionado | Resultados históricos + Calendario Maestro + brief de Dirección | Propuesto |
| **Creativo de contenido** | Redacta copys y guiones por pieza con el tono de Kawiil; prepara los prompts para las imágenes (flujo Gamma ya usado) | Calendario Maestro, guía de marca | Propuesto |
| **Revisor** | Investiga casos, verifica marca y afirmaciones (sobre todo regulatorias: PLD, CNBV) antes de decidir | Todo lo anterior + bitácora | Planeado (entrega 4) |

## 5. Cómo se dejan tareas y se hacen preguntas
Al elegir un agente en la oficina, su panel tiene dos pestañas:
- **Preguntar** (respuesta en el momento): «¿cómo va el análisis de esta semana?». El agente consulta la base y contesta citando **fuente y fecha de corte**.
- **Dejar tarea** (queda en cola): tipo (análisis, informe, propuesta de campaña, redacción, revisión) + descripción. El resultado vuelve como **propuesta** que decide Dirección.

**Implementación recomendada**
- Una Edge Function `marketing-agente` (con la sesión del usuario, `verify_jwt = true`) que comprueba el permiso de Marketing, crea la tarea en **`agent_tasks`** (`task_type = 'question'`, `'analysis'`, `'report'`…) y llama a Claude con el secreto **`ANTHROPIC_API_KEY`**, que **ya existe** en Supabase (lo usan `ai-chat` y otras funciones; solo se mencionan nombres, nunca valores). Así no depende de la Mac (la VM `kawiil-agents` lleva sin latidos desde el 7 jun).
- Reutilizar el registro y las tablas de tareas que ya leen las pantallas (`agent_registry`, `agent_tasks`), con el mismo `mk_registrar_corrida` para dejar latido y contadores.
- Los resultados que implican decisión (campañas, cambios de regla) entran en `mk_propuesta` y se aprueban con `marketing_decidir`; los agentes se ejecutan con una identidad de servicio que **no** tiene ese permiso.

**Salvaguardas (no negociables)**
1. **Las cifras salen de la base, no del modelo.** El agente no «recuerda»: llama a funciones de lectura (`mk_*`) y solo cita lo que devuelven. Una prueba comprueba que cada número de una respuesta aparece en lo que leyó.
2. **Solo lectura sobre Metricool.** Los agentes no tienen el token ni publican, editan, borran ni reprograman. Programar una campaña la hace **una persona** en Metricool.
3. **Privacidad y seguridad del modelo.** El agente no recibe textos de terceros ni de clientes (comentarios, mensajes) para evitar instrucciones ocultas en el contenido; el copy de las piezas viene del Calendario Maestro. Sin secretos en el contexto.
4. **Límites de uso:** tope diario/mensual de llamadas y de tokens, registro de cada llamada (agente, usuario, tokens) y aviso en el panel (no por correo) al acercarse al tope.
5. **Sin avisos externos:** solo panel. Sin correo, Slack ni WhatsApp.

## 6. Anuncios: falta la fuente de datos
La documentación de Metricool que usamos (`docs/marketing-metricool-api.md`) **no incluye anuncios**; el conector solo lee publicaciones orgánicas, calendario y analíticas. Para «cómo se ha visto la mejora de los anuncios» hay que decidir de dónde salen:
- **A.** Si Metricool expone sus datos de anuncios en el plan contratado: se aprueba una ruta de lectura nueva en la lista cerrada del conector (cambio con confirmación) y se mide primero la forma de la respuesta con el modo «forma» (sin ver textos).
- **B.** Meta Ads / LinkedIn Ads directamente: otro conector de solo lectura con su propio secreto (nombre, nunca valor).
- **C.** Carga manual periódica (CSV exportado) mientras no haya conector.
Hasta decidirlo, el Analista de anuncios aparece en la maqueta como «sin datos» y contesta que no puede responder (no inventa).

## 7. Cómo se diseña una campaña (flujo completo)
1. **Brief** (Dirección): objetivo, audiencia, periodo, presupuesto, restricciones.
2. **Estrategia:** el Estratega propone 2–3 enfoques respaldados por resultados históricos (qué pilar, formato y horario funcionó).
3. **Elección:** Dirección elige o pide ajustes (queda en `mk_decision`).
4. **Contenido:** el Creativo redacta copys y guiones; las imágenes con el flujo Gamma.
5. **Revisión:** el Revisor verifica marca y afirmaciones regulatorias; marca lo que no puede sustentar.
6. **Decisión:** Dirección aprueba; las piezas entran al Calendario Maestro (`mk_pieza`).
7. **Programación:** una persona programa en Metricool (el módulo no publica).
8. **Medición:** el Vigilante monitorea; los Analistas miden y el resultado se registra como **experimento** (`mk_experimento`: variable cambiada, esperado, resultado) para aprender.

La carpeta de Cerebro ya tiene antecedentes (por ejemplo el Calendario Maestro y el plan de contenidos de la campaña de Reforma PLD/RCG 2026); sirven como insumo del Estratega. Cómo leerlos desde Supabase depende de cómo se autentique una función contra Cerebro (pendiente desde la entrega 5).

## 8. La parte gráfica
- Componente `OficinaAgentes` en Canvas 2D propio (sin dependencias nuevas), **zonas** Monitoreo / Análisis / Campañas / Revisión, un personaje por agente, estado → animación (escribiendo, leyendo, pensando, esperando decisión, descansando, sin datos, con error) y burbuja `!` cuando hay una propuesta esperando a Dirección.
- Los estados salen de los datos reales: latido, última tarea y su estado. Marca visible de **«propuesto»** para lo que aún no existe (no se simulan agentes que no están).
- **Accesible y calmado** (Zen + Glass): lista de agentes con botones (teclado y lectores de pantalla), `prefers-reduced-motion` sin animación, tema claro y oscuro, sin sonido por defecto; funciona en móvil (sin scroll horizontal, probado en la maqueta).
- v1 con layout fijo (sin editor de oficina); el editor y las mascotas quedan fuera.

## 9. Fases (cada escritura en producción, con su confirmación)
| Fase | Qué entrega | Escrituras en producción |
|---|---|---|
| 0 | Maqueta y este diseño | Ninguna (hecho) |
| 1 | **Hecha en el repo (sin desplegar):** `OficinaAgentes` con los 3 agentes existentes + el panel (estado, objetivo, cumplimiento, historial). Solo lectura. | Ninguna (solo frontend) |
| 2 | **Preguntar** al Analista de resultados (solo lectura de datos del módulo) | Función `marketing-agente`; registrar el agente en `agent_registry`; despliegue |
| 3 | **Dejar tarea** + cola + resultado como propuesta | Migración (tareas/propuestas, límites de uso) |
| 4 | Revisor y propuestas (entrega 4 del plan) | Función, registro |
| 5 | Estratega y Creativo: flujo de campañas con experimentos (entrega 5) | Funciones, registro, tablas de campaña |
| 6 | Analista de anuncios | Conector nuevo (decisión de la sección 6) |

## 10. Decisiones que necesito de Dirección
1. **Motor de los agentes con IA:** Edge Function con Claude y el secreto existente (recomendado) frente a la VM `kawiil-agents` (apagada hoy).
2. **Anuncios:** ¿Kawiil MX corre anuncios hoy, en qué plataformas y cuál es la fuente (A, B o C de la sección 6)?
3. **Quién puede preguntar y quién puede dejar tareas:** ¿el permiso de ver Marketing basta para preguntar y se reserva «dejar tarea» a quien decide?
4. **Presupuesto de IA:** tope mensual de llamadas y de costo.
5. **Qué datos puede ver el modelo:** hoy el módulo no guarda textos de Metricool; el copy está en el Calendario Maestro. ¿Se le da acceso al copy?
6. **Tono y guía de marca:** ¿existe un documento que el Creativo deba seguir?
7. **Arte:** personajes propios (recomendado) o adaptar los de Pixel Agents tras confirmar la licencia del arte.
8. **Relación con los agentes de Cerebro** (Tlahtolli para revisar redacción, Nelli para PLD): ¿consultarlos desde el Revisor más adelante?
9. **Orden:** ¿empezamos por la fase 1 (ver la oficina con lo que ya existe)?

## 11. Riesgos
- **Respuestas con cifras equivocadas** → salvaguarda 1 (cifras solo de la base, con prueba).
- **Afirmaciones regulatorias en campañas** (Kawiil es una firma de cumplimiento): el Revisor no aprueba lo que no puede sustentar; la decisión es siempre humana.
- **Costos** → topes y registro de uso.
- **Expectativa de «anuncios»** sin fuente de datos → se dice abiertamente que no hay datos.
- **Mezclar módulos:** los agentes de Cerebro / `kawiil-agents` van en el otro módulo; aquí solo `marketing_*`.
