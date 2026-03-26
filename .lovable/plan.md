

## Plan: Corregir layout de correo (sin cortes) + crear carpetas

### Problema

1. **Layout cortado**: La página de correo usa `h-[calc(100vh-100px)]` dentro de un contenedor `AppLayout` que tiene sticky header (~40px) + padding (24px arriba y abajo) + `max-w-7xl`. La altura calculada no resta esos espacios correctamente, causando que el contenido se corte por abajo.

2. **No se pueden crear carpetas**: Solo existe `mail-folders` GET. Falta la acción para crear carpetas nuevas vía `POST /me/mailFolders`.

### Cambios

**1. `src/pages/Microsoft365Correo.tsx` — Corregir altura del contenedor**

- Eliminar el wrapper `max-w-7xl` heredado de AppLayout para la página de correo. Usar una clase CSS que override el padding y max-width para que el email ocupe todo el ancho disponible.
- Cambiar `h-[calc(100vh-100px)]` a una altura que reste correctamente el sticky header (~40px) + padding (48px total) = `h-[calc(100vh-130px)]` o mejor usar `h-[calc(100dvh-var)]`.
- Mover el header ("Correo / Outlook") dentro del mismo flujo y reducir su altura.
- Alternativa más limpia: que la página de correo NO use el wrapper `p-6` de AppLayout sino que el `EmailView` sea full-bleed dentro del main.

**2. `src/components/microsoft/EmailView.tsx` — Ajustes de layout**

- Cambiar `h-full` del `ResizablePanelGroup` para que herede correctamente del contenedor padre.
- El iframe del email body: usar auto-resize con `postMessage` para que se ajuste al contenido real (evitar `minHeight: 300px` fijo que puede cortar o dejar espacio vacío).
- Agregar un botón "Nueva carpeta" en el panel de carpetas con un input inline para nombrarla.

**3. `supabase/functions/microsoft-api/index.ts` — Agregar `create-mail-folder`**

- Nueva acción `create-mail-folder`: `POST /me/mailFolders` con body `{ displayName: params.displayName }`.
- Retorna la carpeta creada.

**4. `src/hooks/useMicrosoft.ts` — Hook `useCreateMailFolder`**

- Mutation que llama a la acción `create-mail-folder` e invalida el query de `mail-folders`.

### Archivos a modificar

- `src/pages/Microsoft365Correo.tsx` — fix de altura, full-bleed layout
- `src/components/microsoft/EmailView.tsx` — botón crear carpeta, fix iframe height
- `supabase/functions/microsoft-api/index.ts` — acción `create-mail-folder`
- `src/hooks/useMicrosoft.ts` — hook `useCreateMailFolder`

