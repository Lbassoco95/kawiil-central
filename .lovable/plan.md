

## Plan: Eliminación masiva de tareas en proyecto

### Problema
Para eliminar varias tareas hay que hacerlo una por una. Se necesita un modo de selección múltiple para eliminar en lote.

### Cambios en `src/pages/ProyectoDetalle.tsx`

1. **Estado de selección múltiple**
   - Agregar `selectionMode: boolean` y `selectedTaskIds: Set<string>`
   - Botón "Seleccionar" junto a "Crear tarea" (visible solo si `canDeleteTasks`)
   - Al activar, aparece un checkbox en cada fila de tarea y una barra de acciones flotante abajo

2. **UI de selección**
   - Checkbox (componente existente) al inicio de cada fila de tarea, solo en modo selección
   - Checkbox "Seleccionar todas" en el header de la lista
   - Click en fila: si `selectionMode`, toggle selección en vez de abrir detalle

3. **Barra de acciones masivas**
   - Aparece fija al fondo cuando hay tareas seleccionadas: `"N tareas seleccionadas"` + botón `"Eliminar seleccionadas"` (rojo)
   - Al confirmar, ejecuta `deleteTask.mutateAsync` en secuencia para cada ID seleccionado
   - Usa `DeleteConfirmDialog` con mensaje adaptado: "Se eliminarán N tareas permanentemente"
   - Al terminar, limpia selección, sale del modo selección, invalida queries

4. **Imports adicionales**
   - `Checkbox` de `@/components/ui/checkbox`

### Archivos a modificar
- `src/pages/ProyectoDetalle.tsx` — único archivo afectado

