

## Plan: Subtareas con responsable y creación automática de tarea

### Problema actual
Las subtareas en los pasos de proyecto son simples checkboxes de texto sin responsable ni fecha. No se registran como tareas reales en el módulo de Tareas, perdiendo trazabilidad.

### Solución

Cuando el usuario agrega una subtarea dentro de un paso de proyecto, se muestra un formulario compacto (texto + responsable + fecha de entrega). Al confirmar, se crea automáticamente una tarea real en la tabla `tasks` vinculada al proyecto y cliente, y el checklist item guarda la referencia (`task_id`) para poder abrir el detalle completo.

### Cambios

**1. `src/hooks/useAccountingPeriods.ts`** — Extender `ChecklistItem` con campos opcionales:
```typescript
export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  assigned_to?: string | null;
  due_date?: string | null;
  task_id?: string | null; // link to created task
}
```

**2. `src/components/projects/UnifiedStepRow.tsx`** — Cambios en la sección de subtareas:
- Agregar prop `clientId?: string` para vincular la tarea al cliente
- Reemplazar el input simple de subtarea por un mini-formulario inline con 3 campos: texto, selector de responsable (reutilizando `profiles`), y date picker compacto
- Al agregar subtarea: crear tarea en `tasks` via supabase insert directo (título = texto subtarea, project_id, client_id, assigned_to, due_date, area del paso, created_by = user.id)
- Guardar el `task_id` retornado en el `ChecklistItem`
- En la lista de subtareas, mostrar nombre del responsable y fecha junto al texto
- Al hacer clic en el texto de la subtarea, abrir `TaskDetailDialog` con el `task_id`
- Al togglear completada la subtarea, actualizar también el status de la tarea vinculada

**3. Callers de UnifiedStepRow** — Pasar `clientId` desde los dashboards que lo tengan disponible:
- `StepDetailRow.tsx` — agregar prop `clientId`
- `AnnualStepDetailRow.tsx` — agregar prop `clientId`
- `ComplianceTaskRow.tsx` — ya recibe contexto de proyecto
- `AccountingDashboard.tsx` — pasar `clientId`
- `AnnualDeclarationDashboard.tsx` — pasar `clientId`
- `GestoriaDashboard.tsx` — pasar `clientId`
- `ConstitutionDashboard.tsx` — pasar `clientId`
- `LawsuitDashboard.tsx` — pasar `clientId`
- `ProyectoDetalle.tsx` — ya tiene `project.client_id`, pasarlo a los dashboards que no lo reciben

**4. Estado de sincronización** — Cuando se marca/desmarca una subtarea con `task_id`:
- Actualizar el status de la tarea vinculada (`completada` / `pendiente`)
- Invalidar queries de tasks

### UI de la subtarea en la lista (después de creada)
```
☑ [Texto de la subtarea]  👤 Juan Pérez  📅 25 Mar  [x]
```
Al hacer clic en el texto → abre TaskDetailDialog.

### Sin cambios de base de datos
El `ChecklistItem` se almacena en la columna JSONB existente (`checklist`/`steps`). Las tareas se crean en la tabla `tasks` existente.

