# Archivos al enviar a Slack (Comunicación / API)

**Diagnóstico general** (carga lenta, timeouts, lectura Slack ↔ Kawiil): [slack-comunicacion-diagnostico.md](./slack-comunicacion-diagnostico.md).

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

## Comunicación en tiempo casi real (Kawiil ↔ Slack)

Kawiil **no** usa el socket en tiempo real de Slack. Los mensajes que envías desde Comunicación sí se publican en Slack al instante; lo que **otros** escriben en Slack aparece en Kawiil al:

- Volver a enfocar la ventana del navegador,
- Esperar el refresco automático (~90 s con la pestaña visible), o
- Tras acciones locales (enviar mensaje, reacción, etc.), que invalidan el historial.

Si necesitas ver cambios al segundo, usa el cliente de Slack en paralelo o recarga el canal en Kawiil.

## Permisos OAuth imprescindibles para adjuntos

En **api.slack.com → tu app → OAuth & Permissions → User Token Scopes** deben figurar al menos **`files:write`** y **`files:read`**. Tras cambiar scopes, en Comunicación usa **«Actualizar permisos Slack»** y vuelve a autorizar.
