

## Plan: Markdown en búsqueda/chat, crear tarea desde correo, y mejorar vista de correo con asistente AI

### Problemas identificados

1. **Markdown no renderizado en búsqueda**: El `summary` en `GlobalAISearch.tsx` se muestra como texto plano (`{summary}`) — los `**negritas**` no se renderizan. Falta `ReactMarkdown`.

2. **"Dar de alta" desde correo crea un usuario**: El botón `UserPlus` abre `CreateUserFromEmailDialog` que crea un usuario de Kawiil. El usuario quiere que en su lugar se cree una **tarea** proveniente del correo (con datos del remitente, asunto, etc.).

3. **La vista de correo necesita un asistente AI**: No existe un asistente integrado en la vista de correo para ayudar a redactar respuestas, revisar cadenas de correos, ni generar borradores.

4. **Visualización de correos HTML**: Actualmente usa `dangerouslySetInnerHTML` sin sanitización, lo cual puede tener problemas de estilo y seguridad. Los correos HTML de Outlook a menudo contienen estilos que afectan el layout.

### Cambios

**1. `src/components/shared/GlobalAISearch.tsx` — Renderizar markdown en summary**

- Importar `ReactMarkdown` (ya está en `package.json`)
- Reemplazar `<p>{summary}</p>` por `<ReactMarkdown>{summary}</ReactMarkdown>` con clases `prose prose-sm`
- Las negritas (`**texto**`) y otros formatos se mostrarán correctamente

**2. `src/components/microsoft/EmailView.tsx` — Cambiar "Dar de alta" por "Crear tarea"**

- Reemplazar el botón `UserPlus` / "Dar de alta" por un botón `ClipboardList` / "Crear tarea"
- En vez de abrir `CreateUserFromEmailDialog`, abrir un nuevo `CreateTaskFromEmailDialog`
- Eliminar la importación de `CreateUserFromEmailDialog`

**3. Nuevo: `src/components/microsoft/CreateTaskFromEmailDialog.tsx` — Crear tarea desde correo**

- Dialog con campos pre-llenados desde el correo:
  - Título: `[Correo] {asunto del email}`
  - Descripción: `De: {remitente}\nFecha: {fecha}\n\n{preview del cuerpo}`
  - Enlace al email como referencia
- Campos editables: título, descripción, prioridad, área, asignado a, cliente (opcional)
- Usa `useCreateTask` existente de `useTasks.ts`
- Al crearse, muestra toast de confirmación

**4. `src/components/microsoft/EmailView.tsx` — Agregar asistente AI para redacción**

- Agregar botón `Sparkles` / "Asistente AI" en la barra de acciones del email
- Al hacer clic, abrir un panel lateral o inline donde:
  - Se envía la cadena del correo (asunto + cuerpo) como contexto al `ai-chat`
  - El usuario puede pedir: "Redacta una respuesta profesional", "Resume este hilo", "Traduce al inglés"
  - La respuesta AI se puede copiar al textarea de respuesta con un clic
- Usar `fetch` al endpoint `ai-chat` con un system prompt especial para contexto de correo
- Mostrar respuesta con `ReactMarkdown`

**5. `src/components/microsoft/EmailView.tsx` — Mejorar visualización de correos HTML**

- Envolver el HTML del correo en un `<iframe srcDoc>` con `sandbox` para aislar estilos
- Esto evita que los estilos del correo rompan el layout de la app
- Alternativa: usar un contenedor con `all: initial` y estilos scoped

### Archivos a crear/modificar

- `src/components/shared/GlobalAISearch.tsx` — agregar ReactMarkdown al summary
- `src/components/microsoft/CreateTaskFromEmailDialog.tsx` — **nuevo** dialog para crear tarea desde correo
- `src/components/microsoft/EmailView.tsx` — reemplazar "Dar de alta" por "Crear tarea", agregar asistente AI, mejorar visualización HTML

