

## Plan: Agregar botón de eliminar tareas para Transformadores

### Problema
Los Transformadores (G4) no tienen opción de eliminar tareas desde la vista de proyecto (`ProyectoDetalle`) ni desde el detalle de una tarea (`TaskDetailDialog`). Solo existe en la lista general de `/tareas`.

### Cambios

**`src/pages/ProyectoDetalle.tsx`**
- Importar `Trash2` de lucide-react, `useUserRole`, `useDeleteTask` de hooks, y `DeleteConfirmDialog`
- Agregar estado `deleteTarget` para la tarea a eliminar
- En cada fila de tarea (líneas 278-307), agregar un botón de eliminar visible solo si `canDeleteTasks` es true
- Agregar el componente `DeleteConfirmDialog` al final del JSX
- Invalidar queries de tareas del proyecto tras eliminar

**`src/components/tasks/TaskDetailDialog.tsx`**
- Importar `Trash2`, `useDeleteTask`, y `DeleteConfirmDialog`
- Leer `canDeleteTasks` de `useUserRole()` (ya importado)
- Agregar un botón "Eliminar tarea" en el header o footer del dialog, visible solo si `canDeleteTasks`
- Al confirmar eliminación, cerrar el dialog y ejecutar `deleteTask.mutateAsync`

### Archivos a modificar
- `src/pages/ProyectoDetalle.tsx`
- `src/components/tasks/TaskDetailDialog.tsx`

