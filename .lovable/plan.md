

## Plan: Homologar estructura de tareas/etapas en todo el sistema

### Problema actual

Hay 3 implementaciones distintas para mostrar/editar etapas:

1. **UnifiedStepRow** — Usado por Contabilidad, Gestoría, Constitución, Declaración Anual. Es el más completo pero le faltan: info del creador y motivo obligatorio al cambiar fecha limite.
2. **ComplianceTaskRow** — 450 líneas que duplican el 90% de UnifiedStepRow con su propio timer inline (causa lag), `Textarea` sin debounce, y `UserOrTextSingle/Multi` en vez de selects estándar. No tiene subtareas.
3. **LawsuitDashboard** (stages y deadlines) — Renderizado inline (~200 líneas por sección). No tiene subtareas, timer ni motivo de cambio de fecha.

El estándar a seguir es lo que ya tiene **TaskDetailDialog** (tareas independientes): subtareas, timer, creador, motivo de cambio de fecha, colaboradores, comentarios, archivos, criticidad.

### Solución

Hacer que **UnifiedStepRow sea el componente único** para todas las etapas/pasos de todos los módulos, añadiéndole las features que le faltan, y luego migrar ComplianceTaskRow y LawsuitDashboard stages para usarlo.

### Cambios en UnifiedStepRow

1. **Agregar info del creador** — Mostrar quién creó el paso (campo `created_by` ya existe en AccountingStep, se muestra como texto informativo).
2. **Motivo obligatorio al cambiar fecha límite** — Cuando el usuario cambia `localDueDate`, abrir un mini-formulario de "motivo del cambio" antes de aplicar. El motivo se guarda como comentario automático en StepComments (igual que TaskDetailDialog).
3. **Soporte para `started_at` / `completed_at` automáticos** — Ya parcialmente implementado, asegurar consistencia.

### Migrar ComplianceTaskRow → UnifiedStepRow

**Archivo: `src/components/projects/ComplianceTaskRow.tsx`**

Reescribir este componente para que sea un wrapper delgado alrededor de `UnifiedStepRow`. El wrapper:
- Convierte la tarea de compliance (que es un row en `tasks`) a formato `AccountingStep`
- Pasa `onSave` que hace update directo a la tabla `tasks` y `task_assignees`
- Pasa `onToggle` que marca completada/pendiente
- Mantiene los badges específicos de compliance (periodicidad, periodo) como `extraFields`
- Elimina las ~400 líneas duplicadas de timer, notas, responsable, etc.

### Migrar LawsuitDashboard stages → UnifiedStepRow

**Archivo: `src/components/projects/LawsuitDashboard.tsx`**

Reemplazar el renderizado inline de cada stage (~120 líneas) por `<UnifiedStepRow>`:
- Convertir `LawsuitStage` a `AccountingStep` (mapeo directo, campos ya son compatibles)
- `onSave` actualiza el stage dentro de `lawsuitDetails.stages` y llama `updateLawsuit.mutate`
- Mantener el botón "Eliminar etapa" y legacy attachments como `extraFields`
- Agregar subtareas (que antes no tenía)
- Agregar timer (que antes no tenía)

Los **deadlines** de juicios son diferentes (tienen hora, tipo, asistentes) y se mantienen con su renderizado propio pero se les agrega: subtareas y DebouncedTextarea.

### Actualizar interfaz AccountingStep

**Archivo: `src/hooks/useAccountingPeriods.ts`**

Agregar campo opcional `created_by_name?: string` para mostrar quién creó el paso.

### Archivos a modificar
- `src/hooks/useAccountingPeriods.ts` — Agregar `created_by_name` a la interfaz
- `src/components/projects/UnifiedStepRow.tsx` — Agregar motivo de cambio de fecha + info creador
- `src/components/projects/ComplianceTaskRow.tsx` — Reescribir como wrapper de UnifiedStepRow
- `src/components/projects/LawsuitDashboard.tsx` — Migrar stages a UnifiedStepRow, agregar subtareas a deadlines

### Sin cambios de base de datos

