

## Plan: Corregir subtareas clickeables, ancho de enlaces y menciones en negritas

### Problemas identificados

1. **Subtareas no abren la tarea vinculada** — En `TaskDetailDialog.tsx` (líneas 556-586), los items del checklist que tienen `task_id` no son clickeables. No hay forma de navegar a la tarea vinculada desde la vista de la tarea padre.

2. **Enlaces rompen el ancho del diálogo** — Los attachments en comentarios se guardan como texto plano `📎 [nombre](url)` (línea 291). La función `renderCommentContent` no parsea estos pseudo-links de markdown, así que URLs largas se renderizan como texto corrido sin truncar, desbordando el contenedor.

3. **Menciones no se muestran en negritas** — La regex `/@\w[\w\s]*\w/g` usada en los 3 componentes (`TaskDetailDialog`, `StepComments`, `ProjectCommentsTab`) utiliza `\w` que solo cubre `[a-zA-Z0-9_]`. No reconoce caracteres acentuados (á, é, í, ó, ú, ñ) comunes en nombres en español, por lo que las menciones nunca hacen match.

### Cambios

**1. `TaskDetailDialog.tsx` — Subtareas clickeables**
- En el render de cada checklist item (línea 564), si `item.task_id` existe, envolver el texto en un botón/link que llame `onClose()` y luego abra el TaskDetailDialog de esa subtarea (usando la URL con query param `taskId`).
- Agregar un icono sutil de "abrir" junto al texto para indicar que es clickeable.

**2. `TaskDetailDialog.tsx` — Parsear enlaces en comentarios**
- Actualizar `renderCommentContent` para detectar el patrón `📎 [nombre](url)` y renderizarlo como un link real `<a>` con `truncate` y `break-all` para evitar desborde.
- Agregar `break-words overflow-hidden` al contenedor del comentario (línea 723) para prevenir que cualquier texto largo desborde.

**3. Todos los componentes — Regex de menciones con soporte Unicode**
- Reemplazar `/@\w[\w\s]*\w/g` por una regex que soporte caracteres acentuados: `/@[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w][a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w\s]*[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w]/g`
- Aplicar en los 3 archivos: `TaskDetailDialog.tsx`, `StepComments.tsx`, `ProjectCommentsTab.tsx`
- También actualizar la regex en `MentionTextarea.tsx` `extractMentionIds` (línea 50) que usa el mismo patrón.

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx` — Subtareas clickeables + parsear links + regex Unicode
- `src/components/projects/StepComments.tsx` — Regex Unicode
- `src/components/projects/ProjectCommentsTab.tsx` — Regex Unicode
- `src/components/tasks/MentionTextarea.tsx` — Regex Unicode en extractMentionIds

