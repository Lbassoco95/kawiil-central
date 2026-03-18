

## Plan: Agregar "vs [contraparte]" al nombre de proyectos de Juicios

### Problema
Cuando hay dos juicios del mismo tipo para el mismo cliente (ej. dos "Juicio Civil - Viridiana García Turcott"), no se distinguen. Los campos `plaintiff` y `defendant` ya existen en `lawsuit_details` pero no se reflejan en el nombre del proyecto.

### Solución

**1. Modificar `LawsuitFormDialog.tsx` — Nombre automático con "vs"**
- Línea 85 actualmente genera: `Juicio ${typeLabel} - ${clientName}`
- Cambiar a: `Juicio ${typeLabel} - ${clientName} vs ${defendant || plaintiff}` dependiendo de quién es la contraparte
- Lógica: Si el cliente es el actor (plaintiff), la contraparte es el defendant. Si el cliente es el demandado, la contraparte es el plaintiff. Como el nombre del cliente ya está en el nombre del proyecto, usamos el campo contrario (defendant por defecto, ya que normalmente el cliente es quien demanda).
- Si ambos campos están vacíos, se mantiene el nombre actual sin "vs".

**2. Modificar `LawsuitDashboard.tsx` — Permitir editar plaintiff/defendant y actualizar nombre**
- En la sección de información general del juicio (líneas ~450-465), hacer editables los campos Actor y Demandado si aún no lo son.
- Al cambiar estos campos, además de persistir en `lawsuit_details`, actualizar el nombre del proyecto con el nuevo formato "vs [contraparte]".

**3. Actualizar el encabezado en `ProyectoDetalle.tsx`**
- No requiere cambios: el nombre ya se muestra desde `project.name`, que se actualizará automáticamente.

### Archivos a modificar
- `src/components/projects/LawsuitFormDialog.tsx` — formato del nombre al crear
- `src/components/projects/LawsuitDashboard.tsx` — actualización del nombre al editar plaintiff/defendant

