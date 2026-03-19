

## Plan: Correcciones al módulo de Finanzas y visualización de células

### Problemas identificados

1. **UserManagement solo muestra una célula** — La vista expandida del usuario (línea 227-237) solo muestra `user.area` (texto único del profile). No consulta `user_celulas` para mostrar todas las células asignadas.

2. **Falta célula "Finanzas"** — Solo existe "Administración" en el catálogo de células. Se necesita crear "Finanzas" (slug: `finanzas`) para que `has_finance_access()` funcione correctamente con ambas.

3. **Cliente no debe ser obligatorio en el formulario** — En `ExpenseFormDialog.tsx`, el campo `client_id` aparece como obligatorio visualmente cuando la categoría es "terceros", pero debería ser opcional para todas las categorías excepto quizás "terceros".

4. **Vista de usuario regular necesita mejoras** — La vista para usuarios sin acceso financiero (líneas 174-181 de `Finanzas.tsx`) es muy básica. Necesita mostrar el estatus de sus solicitudes de forma más clara y un mensaje explicativo.

5. **Sin confirmación visible al guardar células** — Cuando se asignan células a un usuario, no hay feedback visual de que se guardaron correctamente las células asignadas.

### Cambios propuestos

**1. `src/components/admin/UserManagement.tsx` — Mostrar todas las células del usuario**
- Importar `useUserCelulas` o crear un query batch que traiga las células de todos los usuarios
- Reemplazar la sección "Célula" (líneas 226-238) para mostrar múltiples badges con las células asignadas vía `user_celulas`, no solo `profiles.area`

**2. Migración de datos — Insertar célula "Finanzas"**
- Insertar en la tabla `celulas` un registro con `name: "Finanzas"`, `slug: "finanzas"`, para que el sistema de acceso funcione

**3. `src/components/finanzas/ExpenseFormDialog.tsx` — Cliente opcional**
- Asegurar que `client_id` sea claramente opcional en todas las categorías
- Quitar el asterisco (`*`) que aparece junto a "Cliente" cuando la categoría es "terceros"

**4. `src/pages/Finanzas.tsx` — Mejorar vista de usuario regular**
- Agregar cards de resumen personales (mis pendientes, mis aprobados, mis pagados)
- Agregar texto explicativo: "Aquí puedes registrar solicitudes de pago y dar seguimiento a tus solicitudes"

**5. `src/components/admin/UserEditDialog.tsx` — Toast de confirmación**
- Agregar un toast que confirme "Células actualizadas" después de guardar exitosamente

### Archivos a modificar
- `src/components/admin/UserManagement.tsx` — Mostrar múltiples células
- `src/components/finanzas/ExpenseFormDialog.tsx` — Cliente opcional
- `src/pages/Finanzas.tsx` — Mejorar vista usuario regular
- `src/components/admin/UserEditDialog.tsx` — Confirmar guardado de células
- Migración SQL — Insertar célula "Finanzas"

