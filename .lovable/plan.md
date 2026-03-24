

## Plan: Arreglar scroll en listas desplegables de SearchableSelect

### Problema
El `ScrollArea` de Radix con `max-h-[200px]` no permite desplazarse correctamente por la lista de opciones. Esto impide ver y seleccionar clientes que están más abajo en la lista.

### Causa raíz
El componente `ScrollArea` de Radix requiere que el viewport interno también tenga restricción de altura. Actualmente el viewport tiene `h-full` sin `max-height`, lo que puede impedir el scroll en ciertos contextos (dentro de popovers, dialogs).

### Solución
En `src/components/shared/SearchableSelect.tsx`:
- Reemplazar `<ScrollArea className="max-h-[200px]">` por un `<div>` nativo con `overflow-y-auto` y `max-h-[300px]` (aumentar un poco la altura para mejor usabilidad).
- Esto garantiza scroll nativo confiable en todos los navegadores y contextos sin depender de la implementación interna de Radix ScrollArea.

### Archivo a modificar
- `src/components/shared/SearchableSelect.tsx` — una sola línea: cambiar el wrapper de `ScrollArea` a un `div` con overflow scroll.

