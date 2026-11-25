# Agentes · oficinas de equipo y chat aparte (R1, R1.b a R1.e, R2, R2.b)

Entrega del 25 nov 2026. Referencia: «Requisitos funcionales: módulo Agentes, espacio de trabajo y versión móvil» (24 nov, Polo) y los tableros de `docs/diseno-oficina-agentes/tableros-v2/` (si el documento y el diseño difieren, manda el documento). Capturas con datos de muestra en `docs/diseno-oficina-agentes/capturas-v2/`.

## Qué hay
- **Oficina de equipo dentro de la sala** (`SalaIsometrica` + `distribuirOficinas` en `src/lib/agentes/salas.ts`): piso de otro color, letrero con el nombre del jefe y el número de agentes (abre la pantalla), un escritorio por agente y siempre un «Lugar libre». Si no cabe, la oficina se ensancha y, si hace falta, la sala crece.
- **Pantalla de la oficina** (`OficinaEquipo.tsx`, `?vista=oficina:<id del jefe>`): Todos los departamentos → sala → oficina; jefe con «Hablar con …»; agentes creados (quién, cuándo, para qué); lugar libre y «Pedirle a … que cree un agente»; organigrama (Dirección → jefe → agentes; el jefe dice en qué equipo dirige y en cuál no); llamadas entre agentes (con resumen de la semana, en curso y con error); cómo crece e historial.
- **Aviso en pantalla de creación** (`AvisoAgentesCreados.tsx`): «X creó a Y», para qué, cuándo, permisos; ver la oficina, revisar permisos, abrir el chat. Solo en pantalla.
- **Chat aparte** (`/agentes/chat/<id>?conv=<conversación>&a=<agentes abiertos>`, `pages/AgentesChat.tsx`): dirección propia, pestañas por agente con nombre y estado (palabra + marca) y botón de cerrar, «Abrir otro agente». «Abrir en pestaña» (enlace con `target="_blank"`) en la lista de la sala, en la oficina y en el escritorio.
- **Panel del agente en la sala** (`ResumenConversacion.tsx`): solo resumen de la última conversación + «Abrir el chat»; **sin cuadro para escribir**. La barra «¿Qué necesitas?» → «Abrir la conversación» ahora lleva al chat.
- **Marketing** (R1.5): la sala de Marketing dibuja también las oficinas de sus agentes; la pantalla de la oficina vive en `/agentes?vista=oficina:<id>`.

## Contrato de datos (para quien mantenga la VM `kawiil-agents`)
Todo sale de `agent_registry.config`; **no hay migración**.
- `creado_por`: hoy el Constructor escribe el id de la persona como texto (sigue valiendo, cuenta como «persona»). Cuando **un agente** crea a otro, la VM debe escribir:
  `config.creado_por = { "tipo": "agente", "id": "<agent_registry.id del creador>", "para": "<motivo, texto corto>" }` y `config.creado_en = "<fecha ISO>"`.
- Una oficina existe cuando un agente activo tiene al menos un agente activo con `creado_por.tipo = "agente"` apuntando a él. El agente creado vive en la sala del departamento de su creador.
- **Solo lectura (decisión de Dirección, 25 nov):** todo agente creado por otro agente empieza en Solo lectura y una persona lo habilita (`config.habilitado = { por, en }`, escrito por `agente-constructor`, acción `habilitar`). También cuenta como Solo lectura `config.modo = "solo_lectura"`. **Pausar:** `config.pausado = { por, en }` (acción `pausar`); `dispatch-to-agent` rechaza (409) las tareas de un agente pausado y quita accesos y permisos de escritura de las de un agente en Solo lectura. Lo que ocurre dentro de la VM lo debe hacer valer la VM: `docs/agentes-vm-requisitos.md`.
- Las llamadas entre agentes salen de `agent_tasks.source_task_id` (R5; la VM aún no las hace).

## Supuestos
1. Quién creó al agente: para lo creado desde el Constructor ya existe (`creado_por` texto + `creado_en` + misión como «para qué»); no se tocó la función `agente-constructor`.
2. «Para qué» de una llamada: solo hay tipo de trabajo (`task_type`); no se muestran títulos ni textos de tareas por privacidad (nota del brief). Se rotula «Tipo de trabajo».
3. Estados de las pestañas: los seis del documento más «Descansando» y «Sin señal», que ya existen en producción. «Atascado» se muestra como «Con error».
4. Cada creador toma un color de piso de una paleta provisional violeta/rosa (distinta de los tintes de las salas) hasta que Dirección decida.
5. El aviso de creación se muestra 14 días y se descarta con «Entendido» (se guarda en el navegador).
6. Tope de pestañas abiertas: 8 (no es el tope de «Varios a la vez», que es decisión pendiente).
7. En Marketing los agentes abren su módulo; por eso su sala no lleva «Abrir en pestaña».
8. El ejemplo del tablero («Vigilante SITI», «[Folio]»…) no está en el código: nada de datos de ejemplo ni campos entre corchetes en producción.

## Cambios respecto al diseño
- El letrero de la oficina va al pie (esquina frontal), no en la esquina superior, para que ningún escritorio lo tape.
- «Pausarlo» está activo (y «Reanudarlo»); el aviso dice que el agente empieza en Solo lectura y ofrece «Habilitarlo» con confirmación. **Estas acciones escriben solo cuando la función `agente-constructor` esté desplegada** (se publica al fusionar a `main`, fuera de 6:30–7:00 CDMX); en una vista previa fallarán con «Acción no válida» mientras tanto.
- Las pestañas de agentes abiertos usan `?a=` en la dirección (ids separados por coma).

## Decisiones pendientes de Dirección (dejadas desactivadas o marcadas)
~~Permisos de un agente creado por otro~~ (decidido: Solo lectura hasta que una persona lo habilite) · cuántos agentes puede crear cada agente / quién no puede crear · cuántos agentes se ven a la vez · permisos del agente llamado · origen de los requerimientos de la autoridad · color de cada oficina · aviso al llegar a 6 agentes en una oficina (`R1.d.5`: **no implementado**, esperando decisión).

## Cambio de datos en producción (NO aplicado; requiere confirmación)
Para que Vigilante SITI aparezca en la «Oficina de Vizumi» hay que escribir, en **una** fila de `agent_registry` (la de Vigilante SITI), solo estas dos claves dentro de `config` (se fusionan con lo que ya tenga; no se tocan otras columnas ni otras filas):
- `creado_por` = `{"tipo":"agente","id":"<id de Vizumi>","para":"<motivo>"}`
- `creado_en` = `<fecha ISO de la creación>`
Reversa: quitar esas dos claves. Falta confirmar el id de ambos agentes, la fecha y el motivo.
