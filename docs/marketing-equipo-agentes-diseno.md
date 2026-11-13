# Marketing · Equipo de agentes: verlos, dejarles tareas, preguntarles y diseñar campañas (diseño, sin implementar)

Estado (5 nov 2026): **fase 1 desplegada** (la oficina con los 3 agentes que ya existen, solo lectura) y **fase 2 construida y probada; paso 1 aplicado en producción** (`mk_analista_datos`, 20261105191631); faltan el paso 2 (registro), fusionar y la prueba (preguntarle al Analista de resultados). El resto es diseño. No se ha escrito nada en producción. Maqueta de todo el equipo: `docs/maquetas/oficina-agentes-marketing.html` (datos de ejemplo, claramente marcada).

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
| 2 | **Preguntar** al Analista de resultados (solo lectura de datos del módulo). **Construida en el repo (sin aplicar):** ver «Fase 2» abajo. | Migración de datos (función SQL de lectura), migración de registro (agente + tabla de consultas), despliegue de `marketing-agente` |
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

## 12. Fase 2 construida: el Analista de resultados (repo, sin aplicar)
**Decisiones adoptadas** (Dirección pidió empezar sin elegir otras; se usaron las recomendadas): motor = Edge Function con Claude y el secreto `ANTHROPIC_API_KEY` que ya existe; el permiso de ver Marketing basta para preguntar; topes de uso por defecto de 30 preguntas por usuario al día y 1 500 000 tokens al mes (se cambian con los secretos `MARKETING_AGENTE_MAX_DIA` y `MARKETING_AGENTE_MAX_TOKENS_MES`, sin tocar código); el modelo por defecto es `claude-sonnet-5-5` (se cambia con `MARKETING_AGENTE_MODELO`). **Sin datos de anuncios** (el Analista lo dice cuando se le pregunta).

**Cómo funciona**
1. La pantalla (`OficinaAgentes`, panel del Analista) llama a la función `marketing-agente` con la sesión del usuario.
2. La función (`supabase/functions/marketing-agente/index.ts`, `verify_jwt = true`) comprueba la sesión y `mk_can_view()` **con la sesión del usuario**; valida la pregunta (3–500 caracteres); aplica los topes; y corre el bucle del agente (`_shared/analista.ts`).
3. El modelo solo puede pedir 10 herramientas de **lista cerrada**, todas servidas por **una** función SQL de solo lectura, `mk_analista_datos` (solo `service_role`): colchón actual, resultados por semana / formato / pilar (una fila por pieza y red, 7d sobre acumulado), semáforo semanal, casos abiertos, informe del día, piezas próximas, reglas vigentes y cobertura de fuentes.
4. **Verificación de cifras:** cada número de la respuesta debe aparecer en lo que leyó de la base (se permite redondeo y porcentaje; enteros 0–10 y años 2020–2035 libres; las fechas deben estar en los datos). Si alguna no está, la respuesta se entrega **marcada «Cifras sin verificar»** con la lista de cifras a revisar.
5. Cada pregunta queda en `mk_consulta` (pregunta, respuesta, verificación, herramientas usadas con su número de filas, tokens, duración) y deja tarea y latido en el registro de agentes (`mk_registrar_corrida`). El Analista es un agente **bajo demanda** (`config.cadencia = bajo_demanda`): se ve «Disponible», nunca «atrasado» por falta de preguntas; mientras responde se dibuja «pensando».

**Archivos**
- SQL: `supabase/migrations/20261105191631_marketing_analista_datos.sql` (**aplicada**) y, `20261105194055_marketing_analista_registro.sql` (**aplicada el 5 nov 2026**); reversas en `tools/marketing/rollback_analista_datos.sql` y `rollback_analista_registro.sql`.
- Función: `supabase/functions/marketing-agente/index.ts` + `_shared/analista.ts` (+ entrada en `supabase/config.toml`).
- Pantalla: `OficinaAgentes.tsx` (panel «Preguntar», historial), `oficinaAgentesLogica.ts`, `agentesRegistroLogica.ts`, hooks `useConsultasAnalista` y `preguntarAlAnalista` en `useMarketing.ts`.
- Pruebas: `_shared/analista.test.ts` y `analista_fuente.test.ts` (Node, 28), `tools/marketing/prueba_analista_pglite.mjs` (Postgres en memoria, 11), `src/test/marketingAnalista.test.tsx` (Vitest, 16).

**Salvaguardas comprobadas por pruebas:** lista cerrada de herramientas (la del modelo coincide exacta con la de SQL); nombres como `constructor` o `__proto__` no se ejecutan; el detalle de un error interno no llega al modelo; órdenes escondidas en los datos solo viajan como resultado de herramienta; el código no menciona Metricool ni su token, solo inserta en `mk_consulta` y llama únicamente a 4 funciones SQL; la respuesta se muestra como texto (sin HTML); la pregunta escrita se conserva si falla; `anon` y `authenticated` no ejecutan `mk_analista_datos` ni escriben `mk_consulta`.

**Dos defectos reales que las pruebas encontraron y ya están corregidos:** un corte de 7 días **nulo** ganaba a un acumulado con dato, y las fechas dentro de marcas de tiempo (`2026-11-05T17:00:00Z`) no se reconocían, lo que habría marcado como «no verificada» una respuesta correcta que cita su corte.

**Orden de puesta en producción (cada paso con la confirmación de Dirección; el orden final es: 1 → fusionar el PR → 2 → pregunta de prueba):**
1. ~~Migración `marketing_analista_datos`~~ **aplicada el 5 nov 2026** a las 13:16 CDMX (solo crea una función de lectura; verificada: `SECURITY DEFINER`, ruta fija, `anon` y `authenticated` sin permiso, `service_role` con permiso, sus salidas con datos reales, y sin cambios en tareas, casos ni trabajos).
2. Migración `marketing_analista_registro` (agente, tabla `mk_consulta` con permisos cerrados, y las dos funciones de registro de corridas aceptan al Analista).
3. **Orden corregido: fusionar el PR a `main` ANTES del paso 2.** El flujo despliega `marketing-agente` (sin su tabla, pero nada la llama) y Vercel publica el panel, que no aparece mientras el agente no esté registrado. Si el paso 2 se aplicara antes, la oficina de producción (sin el código nuevo) dibujaría un personaje gris «Sin datos» encima del Informe, porque no conoce al Analista.
4. Una pregunta de prueba con la sesión de Dirección para comprobar el modelo, la verificación y el registro. **Pendiente de verificar con una llamada real:** el nombre del modelo; no se pudo llamar a la API desde la nube.

**Límites conocidos de esta versión:** no responde sobre anuncios; no recuerda la conversación (cada pregunta es independiente); el historial muestra las últimas 10; una cifra derivada que el modelo calcule por su cuenta (una suma, una diferencia) se marcará «sin verificar» aunque esté bien, por eso se le indica que cite los valores tal cual los devuelven las herramientas.



## 13. Seguimientos del Analista (fase 2b)
- **Qué es:** una pregunta que el Analista responde solo, una vez, a diario o cada semana. Solo lectura; el resultado se ve en el panel (sin correo, Slack ni WhatsApp).
- **Datos:** `mk_seguimiento` (aplicada el 5 nov 2026, migración `20261106003827`); cada respuesta queda en `mk_consulta` con `seguimiento_id`. Tope: 5 seguimientos por usuario, 5 corridas por ejecución y el tope mensual de tokens compartido con las preguntas directas.
- **Código:** `marketing-agente` (acciones `crear_seguimiento` y `cambiar_seguimiento`, con sesión y permiso de Marketing), `marketing-seguimientos` (trabajo diario, secreto propio, reclama con `mk_seguimiento_reclamar` y responde con el mismo Analista) y `_shared/analista_servidor.ts` (modelo y herramientas compartidas).
- **Horario:** 7:45 CDMX, después del Vigía (cron programado el 5 nov 2026, jobid 39; registro en `tools/marketing/cron_analista_seguimientos_0745.sql`).
- **Si una corrida falla:** la fecha ya se adelantó al reclamar, así que no se repite hasta el siguiente periodo; el fallo queda visible en el historial («Sin respuesta») y en el registro del agente.
