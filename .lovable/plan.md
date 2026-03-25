

## Plan: Corregir errores 429 y mantener resumen AI en búsqueda

### Problemas identificados

1. **Error 429 rompe la conversación**: Cuando Claude devuelve 429 (rate limit), la función retorna el error directamente al cliente SIN intentar el fallback al gateway. El `try/catch` en línea 747 no atrapa un `return new Response(429)` — solo atrapa excepciones. Resultado: el chat se muere en vez de cambiar a gateway.

2. **La búsqueda perdió el resumen AI**: El `searchMode` actual devuelve solo resultados estructurados (JSON puro). El usuario quiere mantener los resultados navegables Y el resumen contextual que daba antes.

### Cambios

**1. `supabase/functions/ai-chat/index.ts` — Fallback automático en 429**

- En `handleClaudeChat`: cuando Anthropic devuelve 429, **lanzar un error** (`throw`) en vez de retornar Response. Esto permite que el catch en el handler principal active el fallback al gateway.
- Agregar un pequeño delay (1s) y reintento antes de lanzar el error, por si es transitorio.
- En el handler principal: si ambos proveedores fallan con 429, entonces sí retornar el error al usuario con un mensaje amigable.

**2. `supabase/functions/ai-chat/index.ts` — Agregar resumen AI a búsqueda**

- En `searchMode`: después de obtener los resultados estructurados de `search_across`, hacer una llamada simple (sin tools) a Claude/gateway pidiendo un resumen breve de los resultados encontrados.
- Retornar `{ results: [...], summary: "Resumen contextual..." }`.
- Si la llamada de resumen falla (429, timeout), devolver solo los resultados sin summary — la búsqueda no se rompe.

**3. `src/components/shared/GlobalAISearch.tsx` — Mostrar resumen + resultados**

- Agregar estado `summary` para el texto contextual.
- Renderizar el resumen arriba de los resultados en un bloque con ícono de Sparkles.
- Si no hay summary, mostrar solo los resultados (como ahora).

### Archivos a modificar
- `supabase/functions/ai-chat/index.ts` — fix 429 fallback + summary en searchMode
- `src/components/shared/GlobalAISearch.tsx` — mostrar summary

