# Seguimiento de tareas de agentes y entregables

Pestaña **Agentes → Seguimiento** (solo Dirección): las tareas que se mandan a los agentes, cómo van, qué hicieron y los documentos que entregan.

## Qué muestra
- **Lista** con filtros (Todas · En curso · Terminadas · Con error). Cada estado se dice con texto. Se actualiza sola cada 6 s mientras algo está en curso (20 s si no).
- **Detalle** de una tarea: lo que se le pidió, el avance (eventos de `ai_task_events` y acciones de `agent_activity_logs`: qué consultó, qué leyó), la respuesta del agente, el error si lo hubo y los **documentos entregados** con botón Descargar.
- Todo se pinta como texto plano: nunca como HTML.
- Tras enviar una instrucción en la pestaña Instrucciones aparece el enlace «Ver seguimiento».

## Cómo está hecho
- Función `agente-seguimiento` (`verify_jwt`, solo admin/manager vía `is_admin_or_manager`). Acciones: `listar`, `detalle`, `descargar`. Solo lee; no escribe nada ni toca la VM.
- Lee con service_role porque las tablas de agentes viven en otra organización que los usuarios y `ai_task_events` no es legible para ellos. A cambio, solo tareas de la organización de agentes y solo de agentes que no son de sistema (Marketing tiene su vista).
- Reglas puras y probadas en `supabase/functions/_shared/seguimiento.ts`.

## Documentos (Word, Excel, PDF)
- Los genera la VM (`kawiil-agents`, herramienta `crear_documento`) y los deja en el bucket **privado** `agent-entregables` (migración `20261109140000`): sin ninguna policy para usuarios, así que nadie lo lee por la API de Storage.
- La ruta se saca del registro de la tarea (`result.entregables`), se revalida (debe colgar de la carpeta de ESA tarea) y se firma por **5 minutos**. El navegador nunca recibe la ruta y el body no puede pedir una arbitraria.
- Son borradores del agente: cada archivo lo dice y la pantalla lo recuerda.

## Despliegue
Al fusionar el workflow aplica la migración (bucket) y despliega la función. Después, en `louis-prod`, actualizar `kawiil-agents` (ver `ENTREGABLES.md` en ese repo).
