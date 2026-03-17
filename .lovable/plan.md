

## Plan: Mejorar el flujo de escaneo con selección de carpeta Dropbox

### Situación actual
El botón "Escanear a Dropbox" captura una foto con la cámara y la sube automáticamente a una ruta fija (`/Kawiil Mx/ESCANEOS` o `[carpeta_cliente]/Escaneos`). No permite elegir la carpeta destino.

### Problema
No es posible invocar la app nativa de Dropbox Scanner desde una web app — no existe API para ello. Lo que sí podemos hacer es capturar el documento con la cámara del dispositivo y luego permitir al usuario elegir la carpeta de Dropbox donde guardarlo, usando el explorador de carpetas (`DropboxUploadDialog`) que ya existe en el proyecto.

### Cambios

**Archivo: `src/components/tasks/TaskDetailDialog.tsx`**
1. Al capturar la imagen con la cámara, en lugar de subir automáticamente a una ruta fija, abrir el `DropboxUploadDialog` con el archivo capturado
2. El usuario navega y elige la carpeta destino en Dropbox (o crea una nueva)
3. Al completar la subida, el callback `onUploaded` guarda el enlace compartido en `dropbox_links` de la tarea
4. Importar `DropboxUploadDialog` y agregar estados para controlar el archivo escaneado y la apertura del diálogo

### Flujo resultante
1. Usuario presiona "Escanear a Dropbox" → se abre la cámara
2. Toma la foto → se abre el explorador de carpetas de Dropbox
3. Elige carpeta → sube el archivo → se genera el enlace compartido
4. El enlace queda visible en la pestaña de archivos de la tarea

### Archivos a modificar
- **`src/components/tasks/TaskDetailDialog.tsx`**: Integrar `DropboxUploadDialog`, reemplazar la subida directa por el flujo con selección de carpeta

