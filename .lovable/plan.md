

## Plan: Corregir persistencia de subtareas en dashboards de juicios

### Problema raíz
El `useEffect` en línea 191-193 de `LawsuitDashboard.tsx` sobrescribe `detailsRef.current` cada vez que cambian los props. Cuando la mutación termina y dispara `invalidateQueries`, el refetch puede devolver datos viejos (lag de replicación o timing). Esto sobrescribe el ref con datos sin el checklist recién agregado, y cualquier guardado posterior pierde la subtarea.

Además, el renderizado de etapas (línea 580) usa `lawsuitDetails.stages` de props directamente en vez del ref, causando inconsistencia.

### Solución

**1. `LawsuitDashboard.tsx` — Usar estado local reactivo en vez de solo ref**
- Reemplazar el patrón `detailsRef` + renderizar desde props por un `useState` local (`localDetails`) que sea la fuente de verdad tanto para renderizado como para mutaciones.
- `useEffect` sincroniza desde props SOLO cuando no hay mutación en curso (`updateLawsuit.isPending === false`).
- `persistDetails` actualiza el estado local inmediatamente (optimista) y luego muta al backend.
- El `.map()` de etapas (línea 580) renderiza desde `localDetails.stages` en vez de `lawsuitDetails.stages`.
- Esto elimina la ventana de tiempo donde el ref se sobrescribe con datos viejos.

**2. Mismo patrón para `ConstitutionDashboard.tsx` y `GestoriaDashboard.tsx`**
- Verificar que usen el mismo approach y corregir si es necesario.

**3. Verificar que las líneas 819-824 (Dropbox attachments) también usen `localDetails`**
- Actualmente usan `lawsuitDetails.stages.map(...)` directamente — deben usar el estado local.

### Archivos a modificar
- `src/components/projects/LawsuitDashboard.tsx`
- `src/components/projects/ConstitutionDashboard.tsx`
- `src/components/projects/GestoriaDashboard.tsx`

### Resultado esperado
- Las subtareas se persisten correctamente en la etapa donde se crean.
- El formulario de subtareas sigue mostrando responsable y fecha (esto ya funciona en el código, el problema era que los datos se perdían al guardarse).
- Al recargar la página, la subtarea aparece en la etapa correcta.

