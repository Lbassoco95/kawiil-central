

## Plan: Auto-guardar subtareas al crearlas

### Problema
En `UnifiedStepRow.tsx`, `addChecklistItem()` (línea 186) agrega la subtarea al estado local (`localChecklist`) y crea la tarea en la tabla `tasks`, pero **no llama `onSave()`**. Solo marca `hasChanges = true`, esperando que el usuario haga clic en "Guardar". Si no lo hace, la subtarea desaparece al recargar.

### Solución
Modificar `addChecklistItem()` para que después de agregar el item al checklist local, llame `onSave({ checklist: updatedChecklist })` inmediatamente, persistiendo el cambio sin necesidad de clic en Guardar.

Hacer lo mismo en `removeChecklistItem()` y `toggleChecklistItem()` para que los cambios en subtareas siempre se persistan automáticamente.

### Cambio: `src/components/projects/UnifiedStepRow.tsx`

En `addChecklistItem()`: después de construir `newItem`, crear el array actualizado y llamar `onSave({ checklist: updatedList })` directamente en vez de solo `markChanged()`.

En `toggleChecklistItem()`: después de actualizar el estado local, llamar `onSave({ checklist: updatedList })`.

En `removeChecklistItem()`: después de filtrar el item, llamar `onSave({ checklist: filteredList })`.

Esto garantiza que cualquier cambio en subtareas se persista inmediatamente sin depender del botón Guardar.

