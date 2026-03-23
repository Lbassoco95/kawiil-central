
## Plan: Corregir visualización de enlaces y normalizar nombres de células en el frontend

### Hallazgos
1. En `TaskDetailDialog.tsx` la pestaña **Enlaces** ya tiene `truncate` y `break-all`, pero sigue mostrando la URL completa en una segunda línea. Eso hace que cada tarjeta crezca demasiado y puede seguir empujando la percepción del layout.
2. El frontend todavía tiene varios fallback del tipo `areaLabelMap[slug] || slug` / `celulaLabelMap[slug] || slug`. Cuando el mapa no resuelve, se termina mostrando el slug técnico (`administracion`, `administraci_n`) en vez de la etiqueta correcta (`Administración`).

### Cambios propuestos

**1. `TaskDetailDialog.tsx` — Enlaces más compactos y sin deformar la vista**
- Reemplazar la visualización actual del link por una versión resumida:
  - título visible: `link.name` si existe
  - subtítulo corto: dominio + ruta abreviada, no la URL completa cruda
- Mantener la URL completa solo como `title`, tooltip o acción secundaria, no visible ocupando ancho/alto.
- Reforzar restricciones de layout en toda la cadena del tab:
  - `DialogContent`
  - contenedor scrollable
  - `Tabs`
  - `TabsContent`
  - tarjeta individual del enlace
- Asegurar `min-w-0`, `overflow-hidden`, `truncate` y ancho controlado en todos los nodos flex relevantes.
- Aplicar la misma lógica compacta al render de links dentro de comentarios para que no reaparezca el problema en otra sección.

**2. Etiquetas de células/áreas — Mostrar siempre texto correcto en frontend**
- Centralizar una función/helper de presentación para células, por ejemplo:
  - `administracion` / `administraci_n` → `Administración`
  - `finanzas` → `Finanzas`
  - otros slugs → convertir a texto legible con mayúscula inicial
- Extender `useCelulaOptions.ts` para devolver no solo el mapa, sino también un formateador seguro de etiquetas.
- Sustituir todos los fallback de slug crudo por ese helper compartido.

**3. Pantallas a revisar para el texto correcto**
Actualizar donde hoy se usa `map[slug] || slug`, al menos en:
- `src/components/tasks/TaskDetailDialog.tsx`
- `src/components/admin/UserManagement.tsx`
- `src/pages/Tareas.tsx`
- `src/pages/Proyectos.tsx`

Y durante la implementación revisar cualquier otra ocurrencia similar para que no se vuelva a filtrar el slug técnico en la UI.

### Resultado esperado
- La pestaña **Enlaces** ya no alarga ni deforma la ventana.
- Los links se ven limpios, cortos y legibles.
- En toda la aplicación se mostrará **Administración** con acento y mayúscula correcta, aunque internamente el valor técnico en base de datos sea distinto.
- Se evita que futuros slugs técnicos se vean “tal cual” en el diseño.

### Detalles técnicos
- No requiere cambios de backend ni de base de datos.
- El ajuste principal es de presentación y reutilización de etiquetas.
- La implementación debe seguir el patrón visual ya usado en la app: texto compacto, truncado controlado y labels legibles para usuarios finales.

### Archivos a modificar
- `src/components/tasks/TaskDetailDialog.tsx`
- `src/hooks/useCelulaOptions.ts`
- `src/components/admin/UserManagement.tsx`
- `src/pages/Tareas.tsx`
- `src/pages/Proyectos.tsx`
- y cualquier otro archivo con fallback `labelMap[slug] || slug`
