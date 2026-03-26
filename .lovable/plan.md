

## Plan: Ampliar sistema de notificaciones

### Problema actual

Las notificaciones solo se generan cuando alguien te **@menciona** en un comentario (proyectos o tareas). Falta notificar cuando:
1. Te **asignan una tarea** (o te agregan como colaborador)
2. Te **reasignan** una tarea
3. Se **crea un gasto** (para usuarios en célula de Finanzas/Administración)
4. Se **cambia el estado** de un gasto que tú solicitaste (aprobado, rechazado, pagado)

### Cambios

**1. `src/hooks/useTasks.ts` — Notificar al asignar tarea**

En `useCreateTask` (`onSuccess`): si `assigned_to` o `additional_assignees` existen, insertar notificaciones tipo `task_assigned` para cada usuario asignado (excepto el creador).

En `useUpdateTask` (`onSuccess`): si `assigned_to` cambió, notificar al nuevo asignado con tipo `task_reassigned`.

**2. `src/hooks/useExpenses.ts` — Notificar al crear/actualizar gasto**

En `useCreateExpense` (`onSuccess`): consultar usuarios con célula de finanzas/administración y crear notificación tipo `expense_created` para cada uno.

En `useUpdateExpenseStatus` (`onSuccess`): notificar al solicitante del gasto (`requested_by`) con tipo `expense_status_changed` cuando el estado cambia (aprobado, rechazado, pagado).

**3. `src/pages/Notificaciones.tsx` — Agregar tab "Actividad" y mejorar navegación**

- Agregar una tercera pestaña: `"menciones" | "actividad" | "vencimientos"`
- Tab "Actividad" muestra notificaciones de tipo `task_assigned`, `task_reassigned`, `expense_created`, `expense_status_changed`
- Tab "Menciones" sigue mostrando solo tipo `mention`
- Agregar iconos distintos por tipo (ClipboardList para tareas, DollarSign para gastos)
- Deep-linking: clic en notificación de gasto navega a `/finanzas`, clic en tarea asignada abre el detalle

**4. `src/hooks/useMentionNotifications.ts` — Unificar conteo**

- `useUnreadCount` ya cuenta TODAS las notificaciones no leídas (sin filtrar por tipo), así que el badge en el sidebar ya reflejará las nuevas
- `useMentionNotifications` renombrar internamente para que traiga todas las notificaciones (ya lo hace — query sin filtro de tipo)

**5. `src/hooks/useTasksRealtime.ts` — Ya escucha `notifications`**

No requiere cambios — ya invalida queries de notificaciones en tiempo real.

### Utilidad auxiliar

Crear `src/lib/notificationHelpers.ts` con función reutilizable:
```typescript
async function createNotifications(items: {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  entity_type: string;
  entity_id: string;
  source_user_id: string;
}[])
```
Para evitar duplicar la lógica de obtener `organization_id` e insertar en cada hook.

### Archivos a crear/modificar
- `src/lib/notificationHelpers.ts` — **nuevo**, utilidad para crear notificaciones
- `src/hooks/useTasks.ts` — notificar en asignación/reasignación
- `src/hooks/useExpenses.ts` — notificar a célula finanzas y al solicitante
- `src/pages/Notificaciones.tsx` — agregar tab "Actividad", iconos por tipo, deep-linking a finanzas

