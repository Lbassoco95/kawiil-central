

## Plan: Agregar escáner de documentos en la pestaña de archivos de tareas

### Contexto
Actualmente la pestaña "Archivos" en el detalle de tarea solo permite subir archivos desde el dispositivo. Se necesita agregar un botón de "Escanear" que use la cámara del dispositivo para capturar documentos directamente.

### Solución
Usar la API nativa del navegador `navigator.mediaDevices` / `<input type="file" capture="environment">` para abrir la cámara y capturar una imagen del documento. En dispositivos móviles esto abre directamente la cámara; en escritorio permite seleccionar archivo o cámara.

### Cambios

**Archivo: `src/components/tasks/TaskDetailDialog.tsx`**
- Agregar un segundo botón "Escanear documento" junto al botón existente de "Subir archivo" en la pestaña de archivos
- Este botón usa un `<input type="file" accept="image/*" capture="environment">` que en móvil abre la cámara trasera directamente
- La imagen capturada se sube al mismo storage bucket `documents` con el mismo flujo que `handleFileUpload`
- Se muestra con un icono de cámara/escáner para diferenciarlo visualmente

### Detalle técnico
- Se reutiliza la misma lógica de `handleFileUpload` existente
- El atributo HTML `capture="environment"` activa la cámara trasera en móvil
- En escritorio, el navegador muestra el selector de archivos normal (filtrado a imágenes)
- No requiere cambios en base de datos ni edge functions

