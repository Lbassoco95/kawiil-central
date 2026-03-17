

## Plan: Cascada de actualización de nombre de cliente en tareas

### Situación actual

El hook `useUpdateClient` en `src/hooks/useClients.ts` (líneas 261-283) **ya renombra proyectos** cuando cambia el nombre del cliente — reemplaza el nombre anterior por el nuevo en todos los proyectos vinculados. Sin embargo, **no hace lo mismo con las tareas**, lo que causa la inconsistencia que reportas.

### Cambios propuestos

**Archivo: `src/hooks/useClients.ts`** — en la función `useUpdateClient`, después del bloque de renombrado de proyectos (línea 283), agregar un bloque equivalente para tareas:

1. Consultar todas las tareas con `client_id = id` cuyo `title` contenga el nombre anterior del cliente
2. Renombrar cada tarea reemplazando `previousName` por `updates.name`
3. Invalidar queries de tareas (`["tasks"]`, `["task"]`, `["client-tasks", id]`)

Esto garantiza que al cambiar "Cliente A" → "Cliente B", todas las tareas tipo "Revisión de contratos - Cliente A" se actualicen a "Revisión de contratos - Cliente B" automáticamente.

### Sin cambios de base de datos

No se requieren migraciones. Solo lógica en el hook existente.

