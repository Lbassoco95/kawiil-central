
## Plan: Corregir navegación de subtareas dentro del detalle de tarea

### Problema raíz
Hoy el click de una subtarea en `TaskDetailDialog.tsx` hace esto:
1. Cierra la tarea actual con `onClose()`
2. Cambia manualmente el query param `taskId` con `pushState`

Eso provoca que el usuario “regrese” a la vista de **Tareas** en lugar de abrir la subtarea directamente con el diseño normal del detalle.

### Enfoque
Usar el mismo patrón que ya funciona en `UnifiedStepRow.tsx`: abrir la subtarea con otro `TaskDetailDialog`, sin depender de hacks de URL.

### Cambios propuestos

**1. `src/components/tasks/TaskDetailDialog.tsx`**
- Agregar un estado local para la subtarea seleccionada, por ejemplo `selectedSubtaskId`.
- Reemplazar el `onClick` actual de la subtarea:
  - quitar `onClose()`
  - quitar `pushState`, `PopStateEvent` y `setTimeout`
  - usar `setSelectedSubtaskId(item.task_id)`
- Renderizar un segundo `TaskDetailDialog` cuando exista `selectedSubtaskId`, para abrir esa subtarea con el **mismo diseño completo de tarea normal**.
- Mantener el icono/link visual actual, pero haciendo que abra la subtarea en contexto.

**2. Ajuste defensivo en `src/pages/Tareas.tsx`**
- Agregar sincronización entre `searchParams.get("taskId")` y `selectedTaskId`.
- Esto no será la solución principal del bug, pero sí evita desincronizaciones futuras cuando la URL cambie por deep links o navegación externa.

### Resultado esperado
- Al dar click en una subtarea desde una tarea, se abrirá **esa misma subtarea** con el diseño completo del detalle normal.
- Ya no enviará al usuario “a Tareas” ni lo dejará en la lista.
- Se conserva el contexto actual y la navegación se siente consistente con los pasos de proyecto.

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx`
- `src/pages/Tareas.tsx`
