

## Plan: Permisos granulares para G3 + Fases en minutas

### Parte 1: Permisos granulares para Referentes (G3)

Actualmente hay un solo toggle `referente_task_management` que controla todo. Se separara en dos permisos independientes.

**`src/hooks/useOrgSettings.ts`**
- Agregar dos nuevas propiedades al interface `OrgSettings`:
  - `referente_delete_tasks` — Permite eliminar tareas
  - `referente_edit_due_dates` — Permite modificar fechas limite
- Mantener `referente_task_management` por compatibilidad (se puede eliminar despues)

**`src/hooks/useUserRole.ts`**
- Reemplazar `canManageTasks` por dos flags granulares:
  - `canDeleteTasks`: Transformador siempre true; Referente solo si `referente_delete_tasks` esta activo
  - `canEditDueDates`: Transformador siempre true; Referente solo si `referente_edit_due_dates` esta activo
- Mantener `canManageTasks` como alias (true si cualquiera de los dos esta activo) para no romper nada

**`src/pages/Admin.tsx` (PermissionsTab)**
- Reemplazar el toggle unico por dos toggles independientes:
  1. "Eliminar tareas" — controla `referente_delete_tasks`
  2. "Modificar fechas limite" — controla `referente_edit_due_dates`

**`src/pages/Tareas.tsx`**
- Cambiar `canManageTasks` por `canDeleteTasks` en el boton de eliminar

**`src/components/tasks/TaskDetailDialog.tsx`**
- Cambiar `canManageTasks` por `canEditDueDates` en la edicion de fecha limite

---

### Parte 2: Fases/etapas en creacion de tareas por minutas

En `MeetingMinutesDialog.tsx`, agregar la posibilidad de agrupar tareas en fases antes de crearlas.

**Modelo de datos (solo en memoria, sin DB)**
- Agregar estado `phases` como array de `{ name: string, taskIndices: number[] }`
- Cada tarea puede pertenecer a una fase o a ninguna

**UI en paso "preview"**
- Agregar boton "Agregar fase" que crea una fase con nombre editable
- Las tareas se pueden arrastrar/asignar a una fase via un select en el formulario expandido de cada tarea
- Las tareas se agrupan visualmente por fase, con las sin fase al final

**Al crear tareas (`handleCreateTasks`)**
- Incluir el nombre de la fase en el titulo o descripcion de la tarea como prefijo, ej: `[Fase: Nombre] Titulo de la tarea`
- Esto permite organizacion sin necesidad de cambios en la base de datos

### Archivos a modificar
- `src/hooks/useOrgSettings.ts`
- `src/hooks/useUserRole.ts`
- `src/pages/Admin.tsx`
- `src/pages/Tareas.tsx`
- `src/components/tasks/TaskDetailDialog.tsx`
- `src/components/projects/MeetingMinutesDialog.tsx`

