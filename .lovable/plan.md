

## Plan: Agrupar tareas visualmente por fases/etapas

### Problema
Las tareas con fases se muestran en una lista plana. No hay agrupación visual que permita ver en qué etapa va cada cosa. Solo se ve el prefijo `[Fase]` en el título.

### Cambios

**1. `src/components/projects/MeetingMinutesDialog.tsx` — Agrupar en preview**
- En el paso "preview", en vez de renderizar `proposedTasks.map(...)` en lista plana, agrupar por fase:
  - Primero renderizar cada fase como una sección con header (nombre de fase, icono Layers, count de tareas, fondo sutil)
  - Dentro de cada sección, las tareas que pertenecen a esa fase
  - Al final, sección "Sin fase" para tareas sin fase asignada
- Usar Collapsible (ya existe en el proyecto) para poder colapsar/expandir cada grupo de fase

**2. `src/pages/ProyectoDetalle.tsx` — Agrupar tareas creadas por fase**
- Parsear el prefijo `[NombreFase]` del título de cada tarea para extraer la fase
- Agrupar tareas por fase detectada, con sección "Sin fase" al final
- Cada grupo muestra un header con el nombre de la fase, un badge con el count, y un divider visual
- Si no hay ninguna tarea con fase, mantener la vista plana actual (sin cambio visual)
- Usar Collapsible para expandir/colapsar grupos

### Archivos a modificar
- `src/components/projects/MeetingMinutesDialog.tsx`
- `src/pages/ProyectoDetalle.tsx`

