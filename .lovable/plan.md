

## Plan: Mover correos entre carpetas

### Resumen
Agregar la capacidad de mover correos a otras carpetas, tanto desde un menú contextual (botón "Mover a...") como arrastrando correos a las carpetas del sidebar.

### Cambios

**1. `supabase/functions/microsoft-api/index.ts` — Nueva acción `move-email`**
- Llamar `POST /me/messages/{messageId}/move` con body `{ destinationId: folderId }`
- Retorna el mensaje movido

**2. `src/hooks/useMicrosoft.ts` — Hook `useMoveEmail`**
- Mutation que invoca `move-email` con `messageId` y `destinationFolderId`
- Optimistic update: elimina el correo de la lista actual
- Invalida queries de `outlook-emails` y `mail-folders` (actualizar conteos)

**3. `src/components/microsoft/EmailView.tsx` — UI para mover**
- Agregar botón "Mover a" en la toolbar del detalle del correo (junto a Reply/Forward)
- Al hacer clic, mostrar un dropdown/popover con la lista de carpetas disponibles
- Al seleccionar una carpeta, ejecutar `useMoveEmail` y navegar al siguiente correo
- En la lista de correos: agregar drag-and-drop básico (`draggable` en items, `onDrop` en carpetas del sidebar) para mover arrastrando

### Archivos a modificar
- `supabase/functions/microsoft-api/index.ts` — acción `move-email`
- `src/hooks/useMicrosoft.ts` — hook `useMoveEmail`
- `src/components/microsoft/EmailView.tsx` — botón "Mover a" con dropdown + drag-and-drop en sidebar

