

## Plan: Homologar y mejorar la experiencia de tareas

### Problemas identificados

1. **Célula sin acento** — El campo `area` almacena el `slug` (ej. "administracion"), pero se muestra directamente como texto. Debe usarse `celulaLabelMap` para mostrar "Administración" con acento.

2. **Responsable no obligatorio** — Al crear una tarea, el campo `assigned_to` es opcional. Debe ser obligatorio.

3. **Descripción no obligatoria** — La descripción debería ser requerida para que quien reciba la tarea entienda el contexto.

4. **Subtareas** — La tabla `tasks` ya tiene columna `checklist` (jsonb, default `[]`), pero no hay UI para gestionarla. Se necesita un componente de subtareas con checkbox.

5. **Vista demasiado cargada** — El TaskDetailDialog muestra toda la información al mismo nivel. Necesita reorganizarse en un layout más limpio y minimalista.

### Cambios propuestos

**1. Archivo: `src/components/tasks/TaskFormDialog.tsx`**
- Hacer `assignedTo` obligatorio: validar en `handleSubmit` que no esté vacío, mostrar asterisco en label
- Hacer `description` obligatorio: agregar `required` y asterisco
- Quitar campos de criticidad y motivo de atraso del formulario de creación (se configuran después, en el detalle) para simplificar la creación

**2. Archivo: `src/components/tasks/TaskDetailDialog.tsx`**
- Usar `useCelulaOptions` para resolver `celulaLabelMap[task.area]` y mostrar el nombre con acentos en lugar del slug
- Reorganizar layout minimalista:
  - **Header**: Título + status selector + badge de prioridad (una línea limpia)
  - **Barra de contexto**: Célula (con nombre correcto), cliente, creador, fecha — todo compacto en una línea
  - **Descripción**: Siempre visible debajo del header, con estilo destacado
  - **Subtareas**: Nueva sección con checklist interactivo (checkboxes + input para agregar)
  - **Panel lateral colapsable**: Timer, criticidad/atraso, responsable — en un acordeón o sección secundaria para no saturar
  - **Tabs**: Mantener Comentarios, Enlaces, Archivos al final
- Agregar sección de **subtareas** usando `task.checklist`:
  - Renderizar items como checkboxes con texto
  - Input + botón para agregar nuevas subtareas
  - Guardar con `updateTask.mutate({ id, checklist: [...] })`
  - Mostrar progreso (ej. "3/5 completadas")

**3. Archivo: `src/pages/Tareas.tsx`**
- En la lista de tareas, usar `areaLabelMap[task.area]` en lugar de `task.area` directamente para mostrar nombre con acentos

### Sin cambios de base de datos
La columna `checklist` (jsonb) ya existe en la tabla `tasks`. No se requieren migraciones.

### Archivos a modificar
- `src/components/tasks/TaskFormDialog.tsx` — Responsable y descripción obligatorios, simplificar formulario
- `src/components/tasks/TaskDetailDialog.tsx` — Layout minimalista, fix acentos de célula, subtareas
- `src/pages/Tareas.tsx` — Fix acentos de célula en la lista

