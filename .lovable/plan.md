

## Plan: Mostrar responsable en listas de tareas y homologar visualmente

### Problema

En la pestaña "Tareas" de los proyectos (`ProyectoDetalle.tsx` lineas 268-286) y en la lista principal de tareas (`Tareas.tsx` lineas 195-230), no se muestra el responsable asignado (`assigned_to`). Solo se ven título, prioridad y estatus. Además, la query de `useTasks` no hace join con profiles para obtener el nombre del responsable.

### Cambios

**1. `src/hooks/useTasks.ts`** — Agregar join con profiles en ambas queries:
- `useTasks`: cambiar select a `"*, clients(name), projects(name), profiles!tasks_assigned_to_fkey(full_name)"` o usar un segundo lookup con `useProfiles` (más seguro dado que no hay FK explícita).
- Como la tabla `tasks` no tiene FK declarada a `profiles`, usaremos el hook `useProfiles()` existente para resolver nombres por `assigned_to`.

**2. `src/pages/Tareas.tsx`** — En la lista de tareas (linea 210-218), agregar el nombre del responsable usando `useProfiles()` y mapeando `task.assigned_to` al nombre del perfil. Mostrarlo con icono `User` igual que el cliente.

**3. `src/pages/ProyectoDetalle.tsx`** — En la pestaña "tareas" (lineas 268-286), agregar el nombre del responsable en cada fila de tarea, con el mismo formato visual que en `Tareas.tsx`: badge o texto con icono `User`.

**4. Homologación visual de ambas listas** — Asegurar que las filas de tareas en ProyectoDetalle usen el mismo layout que Tareas.tsx:
- Título + badges de prioridad y estatus con colores centralizados
- Responsable con icono User
- Fecha de vencimiento con icono Calendar
- Indicadores de criticidad/atraso

### Archivos a modificar
- `src/pages/Tareas.tsx` — Agregar nombre del responsable en cada fila
- `src/pages/ProyectoDetalle.tsx` — Agregar responsable y homologar layout de la lista de tareas con el mismo formato que Tareas.tsx

### Sin cambios de base de datos

