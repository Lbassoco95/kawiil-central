

## Plan: Corregir acceso al módulo de Finanzas

### Problema raíz

El slug de la célula "Administración" en la base de datos es `administraci_n` (sin la "o"), pero tanto la función SQL `has_finance_access()` como el hook `useFinanceAccess.ts` buscan el slug `administracion`. Esto causa que ningún usuario con célula de Administración sea reconocido como usuario financiero.

Arely tiene ambas células asignadas (Administración + Finanzas), y los datos están bien guardados. El problema es exclusivamente la comparación de slugs.

### Cambios

**1. Migración SQL — Corregir slug de Administración**
```sql
UPDATE public.celulas SET slug = 'administracion' WHERE slug = 'administraci_n';
```
Esto corrige el slug en la fuente y hace que `has_finance_access()` funcione sin cambios.

**2. `src/hooks/useFinanceAccess.ts` — Agregar slug alterno como respaldo**
Actualizar la comparación para incluir ambas variantes (`administracion`, `administraci_n`) como medida defensiva, en caso de que haya datos históricos con el slug anterior.

### Archivos a modificar
- Migración SQL (1 archivo)
- `src/hooks/useFinanceAccess.ts`

### Resultado
- Usuarios con célula "Administración" o "Finanzas" verán el panel de gestión completo en el módulo de Finanzas
- Todos los demás usuarios seguirán viendo solo su vista de solicitudes personales

