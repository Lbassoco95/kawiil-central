

## Plan: Hacer las tareas clickeables en la vista de detalle de cliente

### Problema
En `ClienteDetalle.tsx`, la pestaña "Tareas" muestra las tareas como filas estáticas sin ningún `onClick` ni diálogo de detalle. No hay `TaskDetailDialog` integrado, por lo que no se puede abrir ni editar ninguna tarea desde la vista del cliente.

### Cambios

**Archivo: `src/pages/ClienteDetalle.tsx`**
1. Importar `TaskDetailDialog` desde `@/components/tasks/TaskDetailDialog`
2. Agregar estado `selectedTaskId` para controlar qué tarea está seleccionada
3. Agregar `onClick` y `cursor-pointer` + `hover:bg-secondary/30` a cada fila de tarea (línea 230) para que al dar click se abra el detalle
4. Renderizar `<TaskDetailDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />` al final del componente

Esto es un cambio mínimo de ~10 líneas en un solo archivo.

