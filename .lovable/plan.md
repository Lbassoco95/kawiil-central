

## Plan: Migrar IA a Claude (Anthropic) con contexto profundo y aprendizaje

### Situación actual
- `ai-chat` usa OpenAI (gpt-4o) como primario, Lovable AI Gateway como fallback
- `ANTHROPIC_API_KEY` ya está configurada en los secrets
- Los tools existentes consultan tareas, clientes, proyectos, recordatorios, equipo, células, Hub
- NO incluyen: comentarios de tareas, descripciones de proyectos, documentos extraídos, actividad reciente
- La búsqueda global (`GlobalAISearch`) usa `supabase.functions.invoke` sin streaming
- El streaming actual es simulado (chunking del texto final)
- Ya existe `process-document` que extrae datos de documentos con Claude y los guarda en `extracted_documents`

### Cambios

**1. `supabase/functions/ai-chat/index.ts` — Migrar a Claude como primario**

- Reemplazar OpenAI como proveedor primario por la API de Anthropic (`https://api.anthropic.com/v1/messages`)
- Modelo: `claude-sonnet-4-20250514`
- Mantener Lovable AI Gateway como fallback en caso de fallo
- Adaptar tool-calling al formato Anthropic (`tool_use` / `tool_result`)
- Streaming real con Anthropic SSE en la respuesta final, reencodando al formato OpenAI-compatible que ya consume el frontend (`data: {"choices":[{"delta":{"content":"..."}}}`)
- Rondas de tool-calling con `stream: false` para resolver tools rápido

**Nuevos tools para contexto profundo:**
- `get_task_details(task_id)` — tarea completa con descripción, comentarios (`task_comments`) y archivos
- `get_project_details(project_id)` — proyecto con descripción, pasos, miembros y tareas asociadas
- `get_recent_activity(limit, entity_type?)` — últimas N entradas de `activity_log`
- `search_across(query)` — búsqueda `ilike` unificada en tareas, clientes y proyectos
- `get_extracted_documents(client_id?, project_id?, limit?)` — consulta `extracted_documents` para acceder a datos extraídos de documentos (CFDIs, declaraciones, estados de cuenta)

**System prompt mejorado:**
- Instrucción de usar toda la información disponible: comentarios, descripciones, documentos extraídos, actividad
- Contexto de Kawiil como despacho contable/legal en México
- Indicar que los documentos procesados están en `extracted_documents` y puede consultarlos

**2. `src/components/shared/GlobalAISearch.tsx` — Usar streaming con tools**
- Cambiar de `supabase.functions.invoke` a `fetch` con streaming SSE (igual que `useChat`)
- Claude usará `search_across` y los tools existentes para buscar datos reales
- Parsear resultados navegables del response streamed

### Detalle técnico

**Formato Anthropic con tools:**
```text
POST https://api.anthropic.com/v1/messages
Headers: x-api-key, anthropic-version: 2023-06-01
Body: { model, system, messages, tools: [{name, description, input_schema}], stream: false }

Tool results: { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }
```

**Streaming final:**
- Tool-calling rounds: `stream: false`
- Final response: `stream: true`, reencoded como SSE compatible con el frontend existente

**Nuevos tools — queries:**
```text
get_task_details(task_id) → tasks + task_comments (con perfil del autor)
get_project_details(project_id) → projects + project_steps + project_members + tasks
get_recent_activity(limit=20) → activity_log ORDER BY created_at DESC
search_across(query) → ilike en tasks.title, clients.name, projects.name
get_extracted_documents(client_id?) → extracted_documents con ai_summary, ai_observations
```

### Archivos a modificar
- `supabase/functions/ai-chat/index.ts` — refactor completo (Claude + nuevos tools + streaming real)
- `src/components/shared/GlobalAISearch.tsx` — usar fetch+streaming en vez de invoke

