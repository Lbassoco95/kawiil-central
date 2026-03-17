

## Plan: Garantizar que el responsable siempre se muestre en las tareas

### Problema identificado

El `TaskDetailDialog` muestra "Creada por: [nombre]" pero **no muestra el responsable asignado** (`assigned_to`). Aunque el campo existe en la base de datos y se puede asignar al crear la tarea, no se visualiza en el detalle de la tarea. Esto da la impresión de que no hay responsable.

Además, en las tareas de Cumplimiento generadas automáticamente, el responsable se asigna como el usuario que las genera (`user!.id`), que coincide con el creador, reforzando la confusión.

### Cambios

**1. `src/components/tasks/TaskDetailDialog.tsx`** — Agregar la visualización del responsable principal en la barra de contexto (junto a "Creada por"), con icono `UserCheck` y nombre resuelto desde `useProfiles`. Incluir un selector para cambiar el responsable directamente desde el detalle (igual que el selector de status que ya existe). Mostrar con formato: "Responsable: [Nombre]".

**2. `src/pages/Tareas.tsx`** — Verificar que el responsable ya se muestra (fue agregado en el cambio anterior). Sin cambios adicionales necesarios.

**3. `src/pages/ProyectoDetalle.tsx`** — Ya muestra responsable. Agregar indicador visual cuando una tarea **no tiene** responsable asignado (texto en rojo/warning "Sin responsable").

**4. `src/components/projects/ComplianceDashboard.tsx`** — Cambiar `responsibleUserId` de `user!.id` al responsable del proyecto/cliente cuando exista, para que las tareas generadas hereden el responsable correcto en vez del usuario que hace clic.

### Detalle de implementación

- En `TaskDetailDialog`, agregar entre "Creada por" y la fecha:
  ```
  Responsable: [Nombre] [botón editar]
  ```
  Con un `SearchableSelect` para cambiar el responsable inline.

- En `ProyectoDetalle` y `Tareas`, mostrar "Sin responsable" con estilo de advertencia cuando `assigned_to` es null.

- En `ComplianceDashboard`, usar el `responsible_user_id` del cliente si existe, fallback al `user!.id`.

### Sin cambios de base de datos

