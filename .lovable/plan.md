

## Plan: Mejorar búsqueda, identidad en chat y memoria cruzada de la IA

### Problemas detectados

1. **Búsqueda ineficiente**: La búsqueda global envía la query completa a Claude con tools, pero los resultados estructurados de `search_across` (con IDs y URLs) se pierden porque el frontend intenta parsear texto libre con regex. El resultado es ruidoso y sin enlaces directos.

2. **El chat no sabe quién es el usuario**: Aunque el system prompt incluye el nombre del usuario, el chat no envía el historial completo de la conversación guardada — solo los mensajes de la sesión actual en memoria.

3. **Sin memoria entre conversaciones**: No existe forma de que Claude consulte conversaciones anteriores del usuario ni de otros usuarios. Cada conversación es aislada.

4. **Error 429 (rate limit)**: Se está pegando al límite de Anthropic, probablemente por enviar demasiados requests de tools.

### Cambios propuestos

**1. `supabase/functions/ai-chat/index.ts` — Mejorar búsqueda y agregar memoria**

- **Nuevo tool `search_platform`**: Reemplaza la búsqueda vía texto libre. Cuando se detecta que es una búsqueda (body incluye `searchMode: true`), ejecutar `search_across` directamente SIN pasar por Claude, devolviendo los resultados estructurados como JSON puro. Esto es más rápido, más barato y más preciso.
- **Nuevo tool `search_past_conversations`**: Consulta `chat_messages` + `chat_conversations` buscando por `ilike` en el contenido de mensajes de la organización completa (no solo del usuario). Devuelve fragmentos relevantes con autor y fecha. Esto permite "memoria cruzada".
- **Enriquecer system prompt**: Agregar instrucción de que si tiene información de conversaciones pasadas que pueda ayudar, la mencione al usuario indicando que "en otra conversación se discutió X".

**2. `src/components/shared/GlobalAISearch.tsx` — Búsqueda directa sin IA**

- Cambiar a modo híbrido:
  - **Búsqueda rápida**: Hacer `fetch` con `searchMode: true` que ejecuta `search_across` directamente y devuelve JSON estructurado con `type`, `id`, `name`, `url`, `extra`
  - **Resumen opcional**: Después de mostrar resultados, opcionalmente pedir un resumen a Claude (botón "Resumir con IA")
- Eliminar el parseo de texto con regex — los resultados vienen estructurados
- Los resultados de clientes navegan a `/clientes/{id}`, proyectos a `/proyectos/{id}`

**3. `src/hooks/useChat.ts` — Enviar historial completo**

- Al cargar una conversación existente (`loadConversation`), ya se cargan los mensajes de BD — esto ya funciona
- Asegurar que `sendMessage` envía todos los mensajes de la conversación (incluyendo los cargados de BD), no solo los de la sesión actual — revisar que `allMessages` incluye el historial completo

**4. `supabase/functions/ai-chat/index.ts` — Endpoint de búsqueda directa**

- Agregar manejo de `searchMode`:
```
if (searchMode) {
  const results = await executeTool("search_across", { query: searchQuery }, supabase, userId, orgId);
  return Response JSON con resultados estructurados
}
```
- Esto evita el costo de una llamada a Claude para búsquedas simples

### Archivos a modificar
- `supabase/functions/ai-chat/index.ts` — agregar `searchMode`, tool `search_past_conversations`, enriquecer system prompt
- `src/components/shared/GlobalAISearch.tsx` — búsqueda directa estructurada
- `src/hooks/useChat.ts` — verificar envío de historial completo

