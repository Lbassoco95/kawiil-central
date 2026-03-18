

## Plan: Sincronizar título de subtarea entre tarea y checklist del paso

### Problema
Cuando se crea una subtarea desde una etapa de proyecto (UnifiedStepRow), se guarda en dos lugares:
1. Una fila en la tabla `tasks` (con su `title`)
2. Un item en el JSONB `checklist` del paso (con campo `text`)

Cuando el usuario edita el título de la tarea en `TaskDetailDialog` y guarda, solo se actualiza la tabla `tasks`. El campo `text` en el checklist JSONB queda con el valor viejo, por lo que el dashboard del proyecto no refleja el cambio.

### Solución

**1. `useUpdateTask` en `useTasks.ts` — Propagar cambio de título al checklist**

Después de actualizar la tarea, si el título cambió (`updates.title`), buscar en `accounting_periods`, `projects` (lawsuit/constitution/gestoria details), y `annual_declarations` si algún checklist item tiene `task_id` igual al id de la tarea. Si lo encuentra, actualizar el `text` de ese item en el JSONB.

Esto es complejo porque habría que escanear múltiples tablas. Mejor enfoque:

**2. `UnifiedStepRow.tsx` — Leer título de la tarea real cuando hay `task_id`**

En vez de mostrar `item.text` del JSONB, cuando un checklist item tiene `task_id`, cargar los títulos actuales de las tareas vinculadas y mostrar esos en lugar del texto guardado en el JSONB.

- Al abrir la fila expandida, hacer un query ligero: seleccionar `id, title` de `tasks` donde `id` esté en la lista de `task_id`s del checklist.
- Renderizar `taskTitles[item.task_id] ?? item.text` en vez de solo `item.text`.
- Esto asegura que siempre se vea el título actualizado sin necesidad de mantener dos fuentes sincronizadas.

**3. Actualizar también el JSONB al cerrar TaskDetailDialog (sync pasivo)**

Cuando `TaskDetailDialog` se cierra después de guardar cambios que incluyen `title`, invalidar queries de `accounting_periods`, `projects`, `annual_declarations` para que al recargar el step, se refresquen los datos. Esto ya ocurre parcialmente con el realtime listener, pero agregaremos invalidación explícita del `project` query.

### Archivos a modificar
- `src/components/projects/UnifiedStepRow.tsx` — Fetch títulos de tareas vinculadas y usar título real en render
- `src/hooks/useTasks.ts` — En `useUpdateTask.onSuccess`, si hubo cambio de título, invalidar queries de accounting/project para forzar recarga

### Resultado
- El título editado en la tarea se refleja inmediatamente en el dashboard del proyecto
- No se requiere escribir en múltiples lugares al editar — la fuente de verdad es la tabla `tasks`

