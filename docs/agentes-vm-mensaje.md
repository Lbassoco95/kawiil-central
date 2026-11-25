# Mensaje para quien mantiene la VM `kawiil-agents` (para copiar y enviar)

**Asunto:** Preguntas sobre kawiil-agents para el módulo Agentes

Hola,

Estamos actualizando el módulo Agentes de Kawiil OS. Algunas partes dependen de la VM `kawiil-agents` y no queremos tocar tu repositorio sin acordarlo contigo. Del lado de Kawiil ya dejamos hechas las reglas que nos tocan. Necesitamos saber qué puede hacer la VM y en cuánto tiempo.

Para cada punto, contesta «sí», «no» o «con cambios», y una fecha estimada.

1. **Estado.** ¿La VM está encendida? ¿Cómo se reinicia y quién lo hace? ¿Qué rama corre: `main` o `legal-brain`?
2. **No pisar datos de Kawiil.** Cuando la VM registra o actualiza un agente, ¿reescribe toda la columna `config`? Necesitamos que conserve estas claves: `pausado`, `habilitado`, `creado_por` y `creado_en`.
3. **Pausa.** Si un agente tiene `config.pausado`, ¿puede la VM no ejecutar sus tareas programadas, no aceptar llamadas de otros agentes y no empezar tareas nuevas? ¿Qué pasa con lo que ya está en curso?
4. **Solo lectura.** Todo agente creado por otro agente empieza en Solo lectura hasta que una persona lo habilita (`config.habilitado`). ¿Puede la VM hacerlo valer —sin escribir en sitios y sin usar accesos de 1Password— en tareas, tareas programadas y llamadas?
5. **Pendientes.** Queremos que todo pendiente que un agente deje en espera se registre con su motivo y con quién lo resuelve. Proponemos dos tablas nuevas, `agent_pendientes` y `agent_pendientes_historial`, que escribe solo la VM con la clave de servicio. Campos: tipo, motivo (máximo 240 caracteres, sin datos de clientes ni secretos), quién lo resuelve (persona, agente o autoridad), estado y fechas. ¿Estás de acuerdo con los campos? ¿Puedes registrar el pendiente al dejar la tarea en espera y cerrarlo cuando se cumpla?
6. **Agentes que crean agentes.** ¿Puede la VM darle a un agente la herramienta para crear otro? Si sí, al crearlo debe escribir `creado_por = {"tipo":"agente","id":"<id del creador>","para":"<motivo>"}` y `creado_en`. ¿Qué tope sugieres de agentes creados por cada agente?
7. **Llamadas entre agentes.** ¿Puede existir la herramienta «consultar a otro agente», con `source_task_id` y estos límites: hasta 6 turnos, una llamada a la vez por conversación y el agente llamado no llama a un tercero? ¿Qué falta para hacerlo?
8. **Avance.** ¿Puedes publicar en los eventos de avance el número de paso y el total, para mostrar «paso 2 de 4»?
9. **Requerimientos de la autoridad.** ¿Puede el agente leer SITI AA y entregar cada requerimiento con folio, autoridad, plazo y estado? Si no pudo leer el folio o el plazo, que lo marque como «plazo no leído».
10. **Memoria.** ¿La VM respeta el interruptor `enabled` de `agent_memories` al recordar?

Lo que NO hemos hecho: no tocamos tu repositorio ni escribimos nada en la base de agentes. Todo lo de arriba está detallado en `docs/agentes-vm-requisitos.md` de `kawiil-central`.

Gracias.
