

## Plan: Agregar responsable y fecha límite a subtareas en TaskDetailDialog

### Problema
En `TaskDetailDialog.tsx`, las subtareas se crean solo con texto (líneas 206-210). No tienen campos de responsable ni fecha límite, y no se crean como tareas reales en la base de datos. En contraste, `UnifiedStepRow.tsx` ya tiene esto implementado correctamente con selector de responsable, calendario de fecha y creación de tarea vinculada.

### Cambios

**`src/components/tasks/TaskDetailDialog.tsx`**

1. **Agregar estados** para `newSubtaskAssignee` y `newSubtaskDueDate` (como ya existe en UnifiedStepRow).

2. **Modificar `addChecklistItem`** para:
   - Crear una tarea real en la tabla `tasks` vinculada al proyecto/cliente de la tarea padre (igual que UnifiedStepRow).
   - Guardar `assigned_to`, `due_date` y `task_id` en el checklist item.

3. **Modificar el formulario de subtareas** (líneas 515-526): cuando el usuario escribe texto, mostrar debajo los selectores de responsable y fecha (mismo patrón visual que UnifiedStepRow con selects compactos y botón "Crear").

4. **Mostrar responsable y fecha** en cada subtarea existente (líneas 497-513): agregar badges de nombre y fecha junto al texto, igual que en UnifiedStepRow (líneas 489-498).

5. **Actualizar `ChecklistItem` interface** (líneas 42-46) para incluir `assigned_to`, `due_date` y `task_id`.

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx`

### Resultado
- Las subtareas en tareas se crean con responsable y fecha límite obligatorios visualmente.
- Se generan como tareas reales para trazabilidad.
- El formato visual se mantiene consistente con el de UnifiedStepRow.

