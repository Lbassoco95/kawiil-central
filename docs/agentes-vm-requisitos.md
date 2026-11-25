# Lo que el módulo Agentes necesita de la VM `kawiil-agents`

Para quien mantiene la VM · 25 nov 2026. Nadie tocó el repositorio de la VM: esto solo dice qué espera la pantalla y qué decidió Dirección. Lo que está en este repositorio (`kawiil-central`) ya lo hace valer del lado de Kawiil; lo de abajo solo lo puede hacer la VM.

## 1. Regla principal (decisión de Dirección)
**Todo pendiente que un agente deje en espera debe registrarse con su motivo y con quién lo resuelve.** Sin motivo y sin responsable no se deja en espera: la tarea falla con un mensaje claro.

Campos de cada pendiente:
| Campo | Qué es |
|---|---|
| `agent_id`, `task_id`, `conversacion` | agente, tarea que quedó en espera y solicitud original (hilo) |
| `tipo` | `aprobacion` · `captura_faltante` · `permiso_bloqueado` · `dato_faltante` · `autoridad` · `otro` |
| `motivo` | texto corto (hasta 240 caracteres), **sin datos personales de clientes ni secretos** |
| `resuelve` | `{ "tipo": "persona" \| "agente" \| "autoridad", "id": "<agent_id si es un agente>" }` |
| `accion` (opcional) | `pedirla` · `aprobar` · `pedir_ayuda` · `revisar` |
| `estado`, `creado_en`, `resuelto_en`, `resuelto_por` | `abierto` → `cumplido` o `cancelado` |

Mientras haya un pendiente abierto, la tarea queda en `waiting_approval`; al cumplirse vuelve a `queued` o `in_progress`.
**Dónde guardarlo (a decidir con Dirección):** una tabla nueva `agent_pendientes` (la migración la haría `kawiil-central`, con confirmación) o, de forma provisional, `agent_tasks.execution_metadata.pendiente`. **Hoy la pantalla solo ve `waiting_approval` sin motivo**; por eso «falta una captura» y «permiso bloqueado» no aparecen.

## 2. Requerimientos de la autoridad (origen pendiente de decisión)
Si `resuelve.tipo = "autoridad"`: `folio`, `autoridad`, `plazo` (fecha) y `estado`. Si no se pudo leer folio o plazo, marcar `plazo_leido = false`: la pantalla lo muestra como «Sin plazo leído» y pide revisión de una persona. Nunca se muestra uno sin folio y plazo.

## 3. Agente que crea a otro agente
- Escribir en el nuevo registro `config.creado_por = { "tipo": "agente", "id": "<id del creador>", "para": "<motivo>" }` y `config.creado_en` (ISO).
- **Nace en Solo lectura** y una persona lo habilita: sin `config.habilitado = { por, en }` no debe usar accesos de 1Password ni escribir en sitios, ni en tareas, ni en programadas, ni en llamadas. (`dispatch-to-agent` ya quita esas autorizaciones de las tareas manuales de un agente en Solo lectura.)
- Por decidir: cuántos agentes puede crear cada agente y cuáles no pueden crear.

## 4. Pausa
Si `config.pausado` existe, no ejecutar tareas programadas, llamadas de otros agentes ni tareas nuevas. `dispatch-to-agent` ya rechaza (409) las tareas manuales de un agente pausado.

## 5. Llamadas entre agentes (R5, aún no existen)
Herramienta «consultar a otro agente»: la tarea nueva lleva `source_task_id`. Límites: hasta 6 turnos, una llamada a la vez por conversación, el agente llamado no llama a un tercero, 2 salas abiertas por persona. Cada llamada queda en `agent_activity_logs` (quién, a quién, cuándo, resultado) y se puede detener. Permisos del agente llamado: solo los propios (propuesta; decisión pendiente). Si le falta uno, debe quedar como pendiente (punto 1).

## 6. Avance
Los eventos de `ai_task_events` con `progress` (0–100) ya se muestran como «Avance N %». Para «paso 2 de 4» haría falta publicar `paso` y `total_pasos` en el `payload`.

## 7. Por confirmar
¿La VM está encendida y cómo se reinicia? ¿Respeta `agent_memories.enabled` al recordar? ¿Cómo se conecta con Cerebro?
