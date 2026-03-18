

## Plan: Nombre editable, botón Guardar y ocultar canceladas en Tareas

### Cambios

**1. `TaskDetailDialog.tsx` — Título editable + botón Guardar**
- Reemplazar el `<DialogTitle>` estático por un `<Input>` editable con estado local (`editTitle`), inicializado desde `task.title`.
- El cambio de status ya se hace inline con `handleStatusChange` que muta inmediatamente. Cambiar esto para que todos los campos editables (título, status, responsable, prioridad) acumulen cambios en un estado local `pendingChanges`.
- Agregar un botón "Guardar cambios" visible en el header cuando hay cambios pendientes. Al hacer clic, se dispara una sola mutación `updateTask.mutate({ id, ...pendingChanges })`.
- Los campos que ya funcionan con guardado inmediato (fecha con justificación, timer, comentarios, checklist) siguen igual porque tienen su propia lógica de confirmación.
- Campos que pasan a guardado con botón: **título**, **status**, **responsable**, **prioridad**, **criticidad**, **atraso**.

**2. `Tareas.tsx` — Ocultar tareas canceladas de la lista principal**
- Filtrar `tasks` para excluir `status === "cancelada"` de la lista visible por defecto.
- Agregar un toggle/botón discreto "Mostrar canceladas" al final de la lista que permite ver las canceladas en una sección separada con estilo atenuado (opacity reducida).

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx`
- `src/pages/Tareas.tsx`

### Resultado
- El título de la tarea es editable directamente en el diálogo.
- Los cambios de datos principales se confirman con un botón "Guardar".
- Las tareas canceladas no ensucian la vista principal pero siguen accesibles.

