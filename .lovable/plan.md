

## Plan: Interfaz de correo estilo Superhuman + AI contextual en respuesta

### Resumen

Redisenar la vista de correo para usar un layout de panel dividido (lista izquierda, detalle derecha) en vez del dialog actual. Reorganizar el asistente AI para que "Resumir hilo" y "Traducir" estén siempre disponibles en la vista del correo, pero "Redactar respuesta" solo aparezca cuando el usuario hace clic en Responder/Reenviar. Revisar que el calendario funcione correctamente.

### Cambios

**1. `src/components/microsoft/EmailView.tsx` — Layout split-pane estilo Superhuman**

- Eliminar el `Dialog` para ver el detalle del correo
- Cambiar a un layout `flex` con dos paneles:
  - **Panel izquierdo (w-[380px])**: lista de correos con scroll, búsqueda arriba, correo seleccionado resaltado con `bg-accent`
  - **Panel derecho (flex-1)**: detalle del correo seleccionado inline, con header (de, para, fecha), cuerpo en iframe, y acciones
- Si no hay correo seleccionado, mostrar un estado vacío ("Selecciona un correo")
- Keyboard navigation: flechas arriba/abajo para navegar la lista

**2. `src/components/microsoft/EmailView.tsx` — Reorganizar AI assistant**

- Siempre visible en el detalle del correo: dos botones pequeños "Resumir hilo" y "Traducir al inglés" (acciones rápidas que ejecutan directamente sin abrir panel)
- El resultado se muestra en un bloque colapsable arriba del cuerpo del correo
- El botón "Kawiil AI" completo (con textarea para instrucciones personalizadas y "Redactar respuesta profesional") solo se muestra cuando `emailAction !== null` (usuario dio clic en Responder/Reenviar/Forward)
- "Usar en respuesta" solo disponible cuando hay acción de respuesta activa

**3. `src/components/microsoft/EmailAIAssistant.tsx` — Separar en dos modos**

- Agregar prop `mode: "quick" | "full"`
- **quick**: solo muestra resultado de resumir/traducir, sin textarea, sin botón cerrar prominente
- **full**: el panel completo con textarea, quick prompts de redacción, y "Usar en respuesta"
- Los quick prompts en modo full cambian: "Respuesta profesional", "Respuesta breve", "Tono formal"

**4. Calendario — Verificación**

- Revisar el `CalendarView.tsx`: la estructura actual parece completa (vistas día/3días/semana/mes, drag&drop, crear/editar/borrar eventos, categorías, Teams)
- El error 404 de eventos ya fue corregido en el mensaje anterior
- No se requieren cambios funcionales al calendario

### Estructura del nuevo layout

```text
┌─────────────────────────────────────────────────┐
│ [🔍 Buscar correos...]                          │
├──────────────┬──────────────────────────────────┤
│ Lista correos│  Asunto: Re: Contrato Fiatcoin   │
│              │  De: Juan <juan@...>              │
│ ▸ Correo 1   │  Para: Equipo                    │
│ ▸ Correo 2 ◄─│  Hace 2 horas                    │
│ ▸ Correo 3   │──────────────────────────────────│
│ ▸ Correo 4   │  [Resumir] [Traducir] [Tarea]    │
│              │  [Responder] [Resp.todos] [Reenv] │
│              │──────────────────────────────────│
│              │  (AI summary si se pidió)         │
│              │──────────────────────────────────│
│              │  Cuerpo del correo (iframe)       │
│              │                                   │
│              │──────────────────────────────────│
│              │  (Si respondiendo:)               │
│              │  [Kawiil AI panel + textarea]     │
└──────────────┴──────────────────────────────────┘
```

### Archivos a modificar

- `src/components/microsoft/EmailView.tsx` — refactor completo a split-pane, reorganizar botones AI
- `src/components/microsoft/EmailAIAssistant.tsx` — agregar modo quick vs full
- `src/pages/Microsoft365Correo.tsx` — ajustar altura del contenedor para que el split-pane ocupe toda la vista

