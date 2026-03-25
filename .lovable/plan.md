## Plan: Corregir fecha límite y actualización automática

### Problemas identificados

1. **Bug de zona horaria**: `formatMX("2025-04-02", ...)` interpreta la fecha como UTC medianoche, luego la convierte a CDMX (UTC-6), resultando en **1 de abril a las 18:00** en vez de 2 de abril. Por eso se ve "01 abr" cuando debería ser "02 abr".
2. **Falta invalidar `project-tasks**`: El hook `useUpdateTask` no invalida la query `["project-tasks"]` en su `onSuccess`, causando que la vista de proyecto no se actualice inmediatamente tras editar una tarea.

### Cambios

`**src/lib/dateUtils.ts**`

- Modificar `toMXDate` para detectar strings de solo fecha (formato `YYYY-MM-DD`) y tratarlos como fecha local en vez de UTC. Esto evita el desfase de un día.

```typescript
export function toMXDate(date: string | Date): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  // Date-only strings (YYYY-MM-DD) are parsed as UTC by JS,
  // which shifts them back a day in CDMX. Fix by parsing as local.
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, day] = date.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  const mxString = d.toLocaleString("en-US", { timeZone: CDMX_TZ });
  return new Date(mxString);
}
```

`**src/hooks/useTasks.ts` — `useUpdateTask` onSuccess**

- Agregar `queryClient.invalidateQueries({ queryKey: ["project-tasks"] })` para que la vista de proyecto se refresque inmediatamente al guardar cambios.

### Archivos a modificar

- `src/lib/dateUtils.ts`
- `src/hooks/useTasks.ts`

Me interesa que también revises que el tiempo para la aplicación debe ser el horario de México, para todo, para los logs y demás mantener esta zona horaria 