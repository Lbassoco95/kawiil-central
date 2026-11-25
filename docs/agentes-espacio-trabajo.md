# Agentes · espacio de trabajo: «Varios a la vez» y «En curso» (R3 y R4)

Entrega del 25 nov 2026.

## Qué hay
- **Dos vistas** en `/agentes/chat/<id>` (`?modo=varios&ver=<ids>`): «Una conversación» y «Varios a la vez». En el celular «Varios a la vez» no aplica (no se ofrece).
- **Varios a la vez:** los chats de los agentes elegidos lado a lado, cada uno con su estado (palabra y marca), «Abrir en pestaña» y «Abrir el chat». **Un solo cuadro** para escribir a los agentes marcados (casilla «Escribirle»); marcando solo uno, se le escribe a uno. El mensaje va como una tarea aparte a cada agente (a su conversación, o abre una nueva si no tiene), así que escribirle a uno no interrumpe a otro. Si un agente está trabajando en esa conversación, no se le encima otra tarea: el resultado dice cuál se envió y cuál no. El cuadro único **no** lleva accesos de 1Password ni permiso de escribir en sitios.
- **En curso:** lista (en las dos vistas) de las conversaciones activas de todos los agentes: agente, estado, última línea y avance. Se actualiza sola (la lista se relee cada pocos segundos mientras algo está en marcha). Al tocar una, se abre su pestaña; leerla no la detiene.

## Pendiente de decisión (marcado, con valor provisional)
- **Cuántos agentes se ven a la vez:** `MAX_A_LA_VEZ = 2` en `src/lib/agentes/espacio.ts` (el valor del diseño). La pantalla lo dice («Se ven hasta 2 a la vez»).

## Supuestos
1. «Avance» es el porcentaje que reporta el agente; «paso 2 de 4» no existe como dato (ver `docs/agentes-vm-requisitos.md`, punto 6).
2. La «última línea» es lo más reciente entre eventos de avance y acciones del agente.
3. «En curso» incluye en espera, en cola, trabajando y esperando aprobación.
4. Al entrar a «Varios a la vez» se marcan por defecto todos los agentes que se ven.
5. Cada panel muestra la última solicitud del agente (se puede cambiar con la lista de sus conversaciones).
