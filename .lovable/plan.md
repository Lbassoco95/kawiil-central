

## Plan: Mostrar todos los clientes en el formulario de juicios

### Problema
En `LawsuitFormDialog.tsx` (línea 77), los clientes se filtran con `.filter((c) => c.services?.includes("juicios"))`. Si solo 2 clientes tienen el servicio "juicios" configurado, solo aparecen esos 2. El fallback a todos los clientes solo aplica si `lawsuitClients` queda vacío, no si tiene pocos resultados.

### Hallazgo adicional
Los demás formularios (`ProjectFormDialog`, `TaskFormDialog`, `DocumentFormDialog`, `ExpenseFormDialog`) ya usan `SearchableSelect` con todos los clientes y orden alfabético. El único problema está en `LawsuitFormDialog`.

### Cambio

**`src/components/projects/LawsuitFormDialog.tsx`**
- Eliminar el filtro `lawsuitClients` (líneas 76-77) y la lógica condicional en línea 168.
- Pasar directamente `(clients || []).map(...)` al `SearchableSelect`, igual que en los demás formularios.
- El componente `SearchableSelect` ya ordena alfabéticamente internamente y permite búsqueda.

### Resultado
- Todos los clientes aparecerán en la lista al crear un juicio, ordenados A-Z y con búsqueda.
- Consistencia con el resto de formularios de la aplicación.

