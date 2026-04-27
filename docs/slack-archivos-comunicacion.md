# Archivos al enviar a Slack (Comunicación / API)

## Qué documenta Slack (y qué no)

- **Slack no publica una lista blanca** de “todos los formatos permitidos”. Lo habitual es que **casi cualquier documento, imagen, audio o vídeo** se pueda subir, salvo restricciones de seguridad o de la organización.
- Lo que **sí** está publicado con precisión es la **lista de extensiones bloqueadas en [Slack Connect](https://slack.com/help/articles/1500002249342-Restricted-file-types-in-Slack-Connect)** (conversaciones con cuentas externas). Ahí no aparecen extensiones típicas de Office (`.docx`, `.pptx`, etc.) ni `.pdf`.

## Si un `.docx` o `.pdf` se rechaza

1. **Política de la organización o del workspace (Enterprise Grid)**  
   Puede existir un bloqueo o DLP que no está en el artículo anterior. Aclarar con el **admin de Slack/IT** del tenant.

2. **Slack Connect**  
   Ajustar permisos de subida: [gestionar subidas de archivos en Slack Connect](https://slack.com/help/articles/1500005777562-Manage-file-uploads-canvas-sharing-and-list-sharing-for-Slack-Connect).

3. **Tamaño**  
   En este producto, la subida a través de `slack-api` rechaza archivos mayores a **~52 MB** (el cliente en Comunicación avisa a **50 MB** por archivo).

4. **Desde Kawiil Comunicación**  
   En caso de error, el toast incluye el **código o mensaje** devuelto por la API de Slack. Para diagnóstico: red → respuesta de la función `slack-api` (cuerpo JSON con `ok: false` y `error: …`).

## Enlaces oficiales

- [Tipos restringidos en Slack Connect](https://slack.com/help/articles/1500002249342-Restricted-file-types-in-Slack-Connect)  
- [Gestionar subidas en Slack Connect (administración)](https://slack.com/help/articles/1500005777562-Manage-file-uploads-canvas-sharing-and-list-sharing-for-Slack-Connect)

Código de referencia: `supabase/functions/slack-api/index.ts` (subida: `getUploadURLExternal` + `completeUploadExternal`, con *fallback* a `files.upload`).
