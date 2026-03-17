

## Plan: Homologar estructura de tareas y mostrar creador

### Diferencias actuales

| Funcionalidad | Pasos de proyecto (UnifiedStepRow) | Tareas (TaskDetailDialog) |
|---|---|---|
| Cronómetro | Si | No |
| Fecha inicio/completado | Si | No |
| Notas | Si (textarea) | Solo delay_notes |
| Creado por | N/A (es un paso) | Campo existe en BD pero no se muestra |
| Comentarios | StepComments (con adjuntos) | Propio (similar) |
| Archivos | StepFileManager | Tab propia (similar) |

### Cambios propuestos

**1. Mostrar quién creó la tarea**

- **`src/hooks/useTasks.ts`** (`useTaskDetail`): Después de obtener la tarea, si `created_by` existe, hacer un query a `profiles` para obtener el `full_name` del creador y adjuntarlo al objeto `task` como `creator_profile`.
- **`src/components/tasks/TaskDetailDialog.tsx`**: Mostrar en la sección de meta info (junto al cliente y área), un badge o texto que diga "Creada por: [Nombre]".

**2. Agregar cronómetro a las tareas**

- **`src/components/tasks/TaskDetailDialog.tsx`**: Agregar el mismo patrón de timer que usa `UnifiedStepRow` — estado `timerRunning`, `displaySeconds`, botones Play/Pause.
- Se necesita agregar las columnas `time_spent_seconds` y `started_at` a la tabla `tasks` via migración.

**3. Mostrar fechas de inicio y completado**

- **`src/components/tasks/TaskDetailDialog.tsx`**: Cuando el status cambie de `pendiente`, registrar `started_at`. Cuando pase a `completada`, registrar `completed_at`. Mostrar ambas fechas en la UI.
- Se necesita agregar `started_at` y `completed_at` (timestamp) a la tabla `tasks` via migración.

### Migración de base de datos
```sql
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS time_spent_seconds integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
```

### Archivos a modificar
- **`supabase migration`**: Agregar 3 columnas a `tasks`
- **`src/hooks/useTasks.ts`**: Fetch `creator_profile` en `useTaskDetail`; auto-set `started_at`/`completed_at` en `useUpdateTask`
- **`src/components/tasks/TaskDetailDialog.tsx`**: Mostrar "Creada por", cronómetro, y fechas de inicio/completado

