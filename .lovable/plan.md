

## Plan: Reorganizar layout de TaskDetailDialog y UnifiedStepRow

### Problema
La vista de tareas y etapas se ve amontonada. Los elementos están comprimidos, el botón "Bloquear tiempo" queda al fondo desconectado, y los controles no tienen una distribución visual clara.

### Cambios

**1. `TaskDetailDialog.tsx` — Layout vertical organizado**

**Header (líneas 345-436)**: Reorganizar en bloques verticales claros:
- Línea 1: Título editable (ancho completo)
- Línea 2: Barra de controles — Status, Prioridad, Responsable en una fila horizontal con espaciado proporcional (`grid grid-cols-3`)
- Línea 3: Información contextual (área, cliente, creador) — queda como texto compacto
- Línea 4: Fila de acciones secundarias — Fecha, Timer, Bloquear tiempo — organizados horizontalmente como botones/badges del mismo tamaño
- Botón "Guardar cambios" se mueve debajo de los controles, visible solo cuando hay cambios

**Body (líneas 441-756)**: 
- Mover "Bloquear tiempo" (líneas 750-755) de abajo del todo a la fila de acciones secundarias del header junto al timer
- Descripción, Subtareas, Colaboradores, Semáforo — se mantienen igual pero con separadores más claros entre secciones
- Tabs de Comentarios/Enlaces/Archivos — sin cambios

**2. `UnifiedStepRow.tsx` — Contenido expandido proporcionado**

**Contenido expandido (líneas 341-577)**: Reorganizar en secciones verticales con separación visual:
- Sección 1: Nombre del paso + Timer (lado a lado en desktop)
- Sección 2: Grid de 3 columnas — Responsable, Estatus, Fecha límite (ya existe, se mantiene)
- Sección 3: Colaboradores
- Sección 4: Subtareas
- Sección 5: Notas
- Sección 6: Comentarios + Archivos
- Botón Guardar — se mantiene al final

Agregar `<Separator />` ligeros entre secciones para dar aire visual. Aumentar el `space-y` de `space-y-3` a `space-y-4` para más respiración.

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx`
- `src/components/projects/UnifiedStepRow.tsx`

### Resultado
- Los controles se distribuyen en filas proporcionadas, no amontonados
- "Bloquear tiempo" se ubica junto al timer donde tiene sentido contextual
- Las secciones tienen separación visual clara
- No se quita ninguna funcionalidad existente

