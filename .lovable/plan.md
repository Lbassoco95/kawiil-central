

## Plan: Mejoras en el detalle de tarea (4 puntos)

### Problemas identificados

1. **Archivos no se pueden descargar/visualizar** — La pestaña "Archivos" muestra los documentos pero no tiene botones de descarga ni vista previa. Solo muestra nombre, tamaño y fecha como texto estático.

2. **@menciones sin formato visible** — En los comentarios, las menciones se renderizan con `text-primary font-medium` pero no en **negritas**. El usuario las quiere más destacadas.

3. **No se pueden adjuntar archivos desde comentarios** — El sistema de comentarios de tareas solo permite texto con @menciones. En contraste, `StepComments.tsx` ya implementa adjuntos en comentarios (archivos, Dropbox, links).

4. **Cliente y célula no visibles** — El campo `area` de la tarea ya existe y se muestra como badge. Si el nombre del cliente no aparece es porque `client_id` no fue asignado al crear la tarea. Esto no es un bug de código sino de datos. Sin embargo, podemos mejorar la visibilidad mostrando siempre el área y cliente de forma más prominente.

### Cambios propuestos

**Archivo: `src/components/tasks/TaskDetailDialog.tsx`**

1. **Agregar descarga y vista previa a archivos (líneas 502-513)**
   - Agregar botón de descarga que genera `createSignedUrl` con `{ download: true }` y abre en nueva pestaña
   - Agregar botón de vista previa que abre `DocumentPreviewDialog` existente
   - Importar `DocumentPreviewDialog` y agregar estado para documento seleccionado

2. **Mejorar estilo de @menciones (línea 116)**
   - Cambiar `className="text-primary font-medium"` a `className="text-primary font-bold"` para que sean negritas

3. **Agregar adjuntos en comentarios**
   - Replicar el patrón de `StepComments.tsx`: agregar estado `attachments`, botón de clip para subir archivos, y botón de Dropbox
   - Los archivos se suben a storage, se genera URL firmada, y se incluyen como parte del contenido del comentario (embebidos como links/imágenes en el texto)
   - Agregar barra de adjuntos con botones de clip, Dropbox y link junto al textarea de comentarios

4. **Hacer más visible el cliente y área**
   - Sin cambios de datos necesarios — el área ya se muestra. Verificar que el `client_id` se propague correctamente al crear tareas desde proyectos de cliente

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx` — todos los cambios principales

### Sin cambios de base de datos
Los comentarios de tarea (`task_comments.content`) ya es texto libre donde se pueden embeber URLs de adjuntos. Las políticas de storage ya permiten lectura a cualquier usuario autenticado.

