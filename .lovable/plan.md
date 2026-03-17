

## Plan: Listas ordenadas con búsqueda + Barra de búsqueda inteligente con AI

### Parte 1: Migrar todos los Select de clientes/usuarios/proyectos a SearchableSelect

El componente `SearchableSelect` ya existe y ya ordena alfabéticamente con búsqueda integrada y scroll. El problema es que varios formularios aún usan `<Select>` plano (sin búsqueda, sin orden). Se deben migrar los siguientes archivos:

**Archivos a modificar:**

1. **`src/components/projects/ProjectFormDialog.tsx`** — Cliente y Célula: reemplazar `<Select>` por `<SearchableSelect>` con opciones ordenadas
2. **`src/components/documents/DocumentFormDialog.tsx`** — Cliente y Proyecto: reemplazar por `<SearchableSelect>`
3. **`src/components/projects/ProjectGeneralTab.tsx`** — Cliente en edición: reemplazar por `<SearchableSelect>`
4. **`src/components/projects/LawsuitFormDialog.tsx`** — Cliente y Responsable: reemplazar por `<SearchableSelect>`
5. **`src/components/clients/ClientFormDialog.tsx`** — Responsable (profiles): reemplazar por `<SearchableSelect>`
6. **`src/components/clients/ClientEditDialog.tsx`** — Responsable (profiles): reemplazar por `<SearchableSelect>`
7. **`src/components/admin/CelulaManagement.tsx`** — Responsable: reemplazar por `<SearchableSelect>`

En cada caso, se construyen las opciones como `{ value: id, label: name }` ordenadas por `localeCompare("es")`, que `SearchableSelect` ya hace internamente. No se tocan los selects de campos con pocas opciones fijas (status, prioridad, tipo de persona, etc.) ya que no necesitan búsqueda.

### Parte 2: Barra de búsqueda inteligente global (powered by AI)

Crear una barra de búsqueda global en el header del `AppLayout` que use la edge function `ai-chat` existente (que ya tiene tools para buscar tareas, clientes, proyectos y usuarios) para responder consultas inteligentes.

**Componente nuevo: `src/components/shared/GlobalAISearch.tsx`**
- Input con ícono de búsqueda en la barra superior del layout
- Al escribir y presionar Enter (o hacer clic en buscar), envía la consulta a la edge function `ai-chat` con un system prompt orientado a búsqueda
- Muestra resultados en un popover/dialog con links directos a proyectos, tareas, clientes
- Resultados clickeables que navegan a la entidad correspondiente
- Badge "Powered by AI" sutil

**Modificar: `src/components/AppLayout.tsx`**
- Integrar `GlobalAISearch` en la barra superior junto al reloj

**Edge function `ai-chat`** — ya tiene los tools necesarios (`get_clients`, `get_all_org_tasks`, `get_projects`, `get_team_members`). Solo se necesita consumirlo desde el nuevo componente con un prompt de búsqueda que instruya al modelo a devolver resultados estructurados con IDs y tipos de entidad para poder generar links de navegación.

### Detalle técnico de la búsqueda AI

El componente enviará un mensaje al edge function `ai-chat` usando tool calling para obtener resultados estructurados. El prompt del sistema pedirá al modelo que use los tools disponibles para buscar y devuelva una lista con `{ type, id, name, url }` que el frontend renderizará como resultados clickeables. Se usará la misma autenticación que el chat existente.

### Archivos a crear
- `src/components/shared/GlobalAISearch.tsx`

### Archivos a modificar
- `src/components/projects/ProjectFormDialog.tsx`
- `src/components/documents/DocumentFormDialog.tsx`
- `src/components/projects/ProjectGeneralTab.tsx`
- `src/components/projects/LawsuitFormDialog.tsx`
- `src/components/clients/ClientFormDialog.tsx`
- `src/components/clients/ClientEditDialog.tsx`
- `src/components/admin/CelulaManagement.tsx`
- `src/components/AppLayout.tsx`

### Sin cambios de base de datos

