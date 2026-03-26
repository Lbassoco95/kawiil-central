

## Plan: Email profesional — paneles redimensionables, carpetas, firma, rich text, hilo de conversación

### Resumen

Transformar la vista de correo en un cliente completo estilo Superhuman: paneles redimensionables, sidebar de carpetas (Inbox, Sent, Drafts, etc.), editor rich-text para respuestas con toolbar de formato, firma de Outlook embebida automáticamente, y visualización de hilos de conversación previos.

### Cambios

**1. `supabase/functions/microsoft-api/index.ts` — Nuevas acciones de Graph API**

- `mail-folders`: `GET /me/mailFolders` — devuelve las carpetas del buzón (Inbox, Sent Items, Drafts, Junk, carpetas personalizadas)
- `email-conversation`: `GET /me/messages?$filter=conversationId eq '{id}'&$orderby=receivedDateTime asc` — trae todos los correos del hilo
- `get-signature`: `GET /me/mailboxSettings` — obtiene la firma HTML configurada en Outlook (`mailboxSettings.signatureSettings` o `mailboxSettings.userPurpose`)
- `create-reply-draft`: `POST /me/messages/{id}/createReply` — crea un borrador de respuesta que ya incluye la firma y el hilo (Graph la inyecta automáticamente)
- `send-draft`: `POST /me/messages/{draftId}/send` — envía el borrador ya creado
- `update-draft`: `PATCH /me/messages/{draftId}` — actualiza el body del borrador antes de enviar

Esto permite: 1) obtener firma automáticamente del borrador, 2) mantener el hilo completo, 3) soporte de HTML en respuestas.

**2. `src/hooks/useMicrosoft.ts` — Nuevos hooks**

- `useMailFolders()` — lista de carpetas con `displayName`, `id`, `unreadItemCount`
- `useEmailConversation(conversationId)` — correos del hilo ordenados cronológicamente
- `useCreateReplyDraft()` — crea borrador con firma
- `useSendDraft()` — envía borrador
- Modificar `useOutlookEmails(folderId)` para aceptar folder ID dinámico en vez de hardcoded "inbox"

**3. `src/components/microsoft/EmailView.tsx` — Refactor completo**

Layout de 3 columnas con paneles redimensionables (`react-resizable-panels`):

```text
┌──────────┬──────────────┬──────────────────────────┐
│ Carpetas │  Lista       │  Detalle correo          │
│          │  correos     │                          │
│ Inbox(3) │  ▸ Correo 1  │  [Hilo conversación]     │
│ Enviados │  ▸ Correo 2  │  [Correo actual]         │
│ Borradores│ ▸ Correo 3  │  ──────────────────────  │
│ Spam     │              │  [Editor rich-text]      │
│ ──────── │              │  [con firma embebida]    │
│ Carpeta1 │              │                          │
│ Carpeta2 │              │                          │
└──────────┴──────────────┴──────────────────────────┘
```

- **Panel 1 (sidebar carpetas, w ~180px)**: lista de carpetas con badge de no leídos, carpeta seleccionada resaltada, scroll si hay muchas
- **Panel 2 (lista correos, w ~320px)**: igual que ahora pero alimentada por `folderId` seleccionado
- **Panel 3 (detalle)**: correo + hilo + respuesta
- Paneles redimensionables con `ResizablePanelGroup` ya existente en el proyecto

**4. Hilo de conversación en el panel de detalle**

- Debajo del correo actual, mostrar los correos previos del hilo (`conversationId`) colapsados
- Cada correo previo muestra: remitente, fecha, y body colapsable (expandir al hacer clic)
- Orden cronológico descendente (más reciente arriba)

**5. Editor rich-text para respuestas**

- Reemplazar `<Textarea>` por un editor con toolbar de formato básico:
  - Botones: **Negrita**, *Itálica*, lista, link
  - Implementado con `contentEditable` div + `document.execCommand` (simple, sin dependencias)
  - Output en HTML para que Microsoft Graph lo envíe como HTML body
- El flujo cambia: al hacer clic "Responder", se llama `create-reply-draft` que devuelve un borrador con firma y body HTML del hilo. El editor se inicializa con ese contenido, el usuario edita arriba de la firma.

**6. Firma de Outlook**

- Al crear reply draft via Graph API (`createReply`), Microsoft automáticamente inyecta la firma del usuario en el body del borrador
- El editor se inicializa con el HTML del borrador (que ya contiene firma + quoted text)
- El cursor se posiciona al inicio del body, antes de la firma
- No se necesita llamar a `mailboxSettings` separadamente — la firma viene en el draft

### Archivos a crear/modificar

- `supabase/functions/microsoft-api/index.ts` — agregar acciones: `mail-folders`, `email-conversation`, `create-reply-draft`, `update-draft`, `send-draft`
- `src/hooks/useMicrosoft.ts` — nuevos hooks para carpetas, conversación, drafts
- `src/components/microsoft/EmailView.tsx` — refactor a 3 paneles, carpetas, hilo, rich-text editor
- `src/components/microsoft/RichTextEditor.tsx` — **nuevo**, editor contentEditable con toolbar
- `src/pages/Microsoft365Correo.tsx` — ajustar layout contenedor

