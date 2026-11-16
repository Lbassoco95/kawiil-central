# Salas de agentes — diseño (borrador para decidir)

Objetivo: que varios agentes **trabajen juntos en una sala** que una persona puede ver, para entenderlos mejor, entrenarlos y nutrir su memoria con esa interacción y su seguimiento. Todo en solo lectura para quien observa; Dirección decide.

## Qué es una sala
Un tema + 2 o 3 agentes de **consulta** (nunca agentes con escritura ni con accesos) + una conversación en turnos. Cada turno es una tarea de un agente, **encadenada** a la anterior con `agent_tasks.source_task_id` (ya existe; hoy sin uso). La sala es el hilo de esas tareas; se ve en el plano (líneas entre islas, ya incluidas en la fase 1) y en una pestaña **Salas**.

## Reglas propuestas
- **Participantes:** solo agentes consultables, activos, elegidos por Dirección. Nunca se pasan accesos de 1Password ni permiso de escribir.
- **Turnos:** los lanza una persona («Siguiente turno») al principio; automático solo después, con tope.
- **Topes:** máximo 6 turnos por sala, 2 salas abiertas por persona, y un tope diario de costo que cuenta para el mismo tope mensual de IA.
- **Profundidad:** un agente consulta a otro; el consultado no delega más.
- **Qué se guarda en memoria:** nada automático. Al cerrar la sala, el sistema **propone** memorias candidatas; una persona aprueba cuáles guardar (hoy solo se puede apagar, nunca ver texto, hasta que Dirección decida otra cosa).
- **Auditoría:** cada turno queda enlazado (quién llamó a quién, cuándo, con qué estado) sin títulos ni resultados en pantalla.

## Piezas que faltan (por fases)
1. **Fase 1 (hecha, PR #560):** ver llamadas entre agentes y revisar/apagar memoria.
2. **Fase 2:** `dispatch-to-agent` acepta `source_task_id` con validaciones (misma organización, profundidad 1, topes, solo agentes consultables) y devuelve el hilo.
3. **Fase 3 (VM `kawiil-agents`, fuera de este repo):** que el agente reciba el contexto del turno anterior y la herramienta «consultar a otro agente». Hay que especificarla con quien mantiene la VM.
4. **Fase 4:** pestaña **Salas** (crear, ver en vivo, cerrar con memorias candidatas) y botón «Abrir sala» desde el plano.

## Decisiones pendientes de Dirección
- ¿Quién puede abrir salas (solo Dirección o también otros roles)?
- ¿Tope diario de costo de las salas?
- ¿Se permite ver el texto de una sala (las respuestas de los agentes) o solo el esquema de quién habló con quién?
