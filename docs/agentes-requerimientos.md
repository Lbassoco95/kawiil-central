# Agentes · panel «Requerimientos» (R6: Pendientes de ti y Documentos)

Entrega del 25 nov 2026. Capturas (datos de muestra) en `docs/diseno-oficina-agentes/capturas-v2/requerimientos-*.png`.

## Qué hay
- **Panel «Requerimientos»** arriba de cada conversación (`PanelRequerimientos.tsx`), plegable, con tres pestañas y sus totales.
- **Pendientes de ti:** tareas de cualquier agente que esperan a la persona (`waiting_approval`), la más antigua primero. Cada una dice el agente, el motivo y trae su acción: **Aprobar** (cuando el agente propuso un plan de encargo; usa la misma aprobación que ya existía) y **Abrir el chat** (lleva a la solicitud original). Al cumplirse, sale de la lista y queda en el historial de su conversación.
- **Documentos:** la lista «Documentos de esta conversación» que ya existía, reubicada aquí (Ver PDF y Descargar, sin duplicados).
- **Franja «Equipo en vivo»:** ahora muestra el total de pendientes de todos los agentes («3 pendientes de ti»), contados por tarea y no por agente.

## Lo que NO se puede sin cambios en la VM `kawiil-agents` (no se tocó)
- «Falta una captura» y «permiso bloqueado» (con «Pedirla» y «Pedir ayuda a …»): hoy no existe un dato estructurado de «lo que el agente necesita de ti». Hace falta que la VM registre cada pendiente con motivo y tipo (por ejemplo `config`/tabla de pendientes del agente). Mientras tanto, el único pendiente real es la espera de aprobación.
- Por eso el criterio de aceptación «Vigilante SITI pide una captura que falta…» **aún no se cumple**; sí se cumple para aprobaciones.

## De la autoridad (sin datos, a propósito)
La pestaña existe pero **no muestra datos ni ejemplos**: el origen de los requerimientos de la autoridad es una decisión pendiente de Dirección (que el agente los lea y estructure, o que una persona los capture). Cuando haya datos: nunca se muestra uno sin folio y plazo; si el agente no pudo leerlos, aparece como **«Sin plazo leído»** y pide revisión de una persona (R6.4, no se oculta); ordenados por plazo; los vencidos con la palabra y los días de retraso (R6.5).

## Supuestos
1. «Pendientes de ti» muestra los de **todos** los agentes (la lista no se limita al agente de la conversación), porque cada fila nombra al agente.
2. Los datos salen de `agente-seguimiento` (solo Dirección). La franja usa `agent_tasks` (sin títulos).
3. «Aprobar» solo aparece si el hilo del pendiente tiene un plan propuesto; las demás esperas se resuelven en su chat.
