

## Plan: Homologar colores, capitalización y estilos visuales en toda la plataforma

### Problema

Los mismos status se muestran con colores y capitalización diferentes según el módulo:

| Status | Tareas.tsx | TaskDetailDialog | UnifiedStepRow |
|--------|-----------|-----------------|----------------|
| En progreso | `bg-primary/10 text-primary` | `bg-blue-100 text-blue-800` | `bg-blue-100 text-blue-800` |
| Completada | `bg-success/10 text-success` | `bg-green-100 text-green-800` | `bg-green-100 text-green-800` |
| En revisión | `bg-warning/10 text-warning` | `bg-yellow-100 text-yellow-800` | — |

Capitalización inconsistente: "En progreso" vs "En Progreso", "Esperando cliente" vs "En Espera del Cliente".

### Solución

Crear un archivo centralizado `src/lib/statusStyles.ts` con todas las configuraciones de status y usarlo en todos los archivos.

### Archivo nuevo: `src/lib/statusStyles.ts`

Constantes centralizadas con capitalización Title Case y colores uniformes (usando `bg-blue-100`, `bg-yellow-100`, `bg-green-100`, `bg-red-100` como estándar):

- **Task status**: Pendiente, En Progreso, En Revisión, Completada, Cancelada
- **Step status**: Pendiente, En Progreso, En Espera del Cliente, Completado
- **Priority styles**: Urgente, Alta, Media, Baja
- **Client status**: Activo, Inactivo, Prospecto
- **Project status**: Activo, Pausado, Completado, Cancelado

### Archivos a modificar

1. **`src/lib/statusStyles.ts`** (nuevo) — Configuraciones centralizadas
2. **`src/hooks/useAccountingPeriods.ts`** — Actualizar `STEP_STATUS_OPTIONS` labels: "En Progreso", "En Espera del Cliente"
3. **`src/components/projects/UnifiedStepRow.tsx`** — Importar estilos desde archivo centralizado, eliminar `STEP_STATUS_STYLES` local
4. **`src/components/tasks/TaskDetailDialog.tsx`** — Reemplazar `statusLabels` local por import centralizado
5. **`src/pages/Tareas.tsx`** — Reemplazar `statusLabels` y `stepStatusLabels` locales. Cambiar colores de `bg-primary/10` a `bg-blue-100` etc.
6. **`src/pages/ClienteDetalle.tsx`** — Reemplazar `TASK_STATUS_LABELS` y `TASK_PRIORITY_STYLES` locales
7. **`src/pages/Clientes.tsx`** — Importar `STATUS_LABELS` y `STATUS_STYLES` de clientes desde centralizado
8. **`src/pages/Proyectos.tsx`** — Importar `STATUS_LABELS` y `STATUS_STYLES` de proyectos desde centralizado
9. **`src/pages/ProyectoDetalle.tsx`** — Importar estilos de proyecto desde centralizado
10. **`src/components/projects/ComplianceTaskRow.tsx`** — Actualizar `PERIODICITY_LABELS` capitalización
11. **`src/components/projects/ProjectGeneralTab.tsx`** — Importar estilos de proyecto desde centralizado

### Sin cambios de base de datos

