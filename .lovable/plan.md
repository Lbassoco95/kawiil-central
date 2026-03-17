

## Plan: Corrección de creación de tareas y mejoras en la gestión

### Problema raíz
La columna `area` en la tabla `tasks` usa el enum `service_area` que solo tiene 9 valores fijos (contabilidad, legal, etc.). La célula "Administración" tiene slug `administraci_n` que **no existe** en ese enum, causando el error `invalid input value for enum service_area: "administraci_n"`.

---

### Cambios planificados

**1. Migración de base de datos: `tasks.area` de enum a texto**
- Cambiar la columna `area` en `tasks` de tipo `service_area` a `text` (igual que ya se hizo con `profiles.area`)
- Esto permitirá cualquier célula dinámica sin depender del enum fijo

**2. Ordenamiento alfabético y búsqueda en selectores**
- En `TaskFormDialog` y `TaskDetailDialog`: ordenar perfiles, clientes y colaboradores alfabéticamente por nombre
- Agregar campo de búsqueda (filtro) en los selectores de responsable, colaboradores y clientes usando `Command` (combobox con búsqueda)

**3. Visualización de tareas para todos los usuarios**
- Verificar y corregir que el `TaskDetailDialog` se abra correctamente para cualquier usuario de la organización (las RLS ya permiten SELECT a usuarios de la org)

**4. Fecha límite editable con comentario obligatorio**
- En `TaskDetailDialog`, hacer la fecha límite editable por el responsable o colaboradores asignados
- Al cambiar la fecha, mostrar un campo de texto obligatorio para justificar el cambio
- El sistema guardará automáticamente un comentario con la justificación y registrará el cambio

---

### Archivos a modificar
- **Nueva migración SQL**: Alterar `tasks.area` de `service_area` a `text`
- **`src/components/tasks/TaskFormDialog.tsx`**: Ordenar listas alfabéticamente, agregar búsqueda en selectores
- **`src/components/tasks/TaskDetailDialog.tsx`**: Agregar edición de fecha límite con comentario obligatorio, ordenar listas, agregar búsqueda
- **`src/hooks/useTasks.ts`**: Ajustar el cast de tipo para `area` en `useCreateTask`

