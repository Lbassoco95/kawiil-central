-- Caché server-side para respuestas de IA (Anthropic) compartido entre
-- usuarios/dispositivos. Objetivo: absorber los 429 del tier 1 de Anthropic
-- evitando golpear la API cuando ya resumimos el mismo contenido antes.
--
-- Edge Functions que la usan:
--   - email-ai-summary
--   - email-ai-quick-reply
-- (puede extenderse a slack/calendar sin tocar esquema).
--
-- Llave de caché: SHA-256 del contenido relevante (asunto + body + thread).
-- Scope: identifica la Edge Function productora (p. ej. "email-summary").

CREATE TABLE IF NOT EXISTS public.ai_response_cache (
  cache_key text NOT NULL,
  scope text NOT NULL,
  response jsonb NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_response_cache_created_at
  ON public.ai_response_cache (created_at DESC);

ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

-- Sólo el service role (Edge Functions) puede leer/escribir. Los clientes
-- no necesitan acceso porque pasan por la Edge Function.
DROP POLICY IF EXISTS "service_role manages ai cache" ON public.ai_response_cache;
CREATE POLICY "service_role manages ai cache"
  ON public.ai_response_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.ai_response_cache IS
  'Caché persistente de respuestas de IA (Anthropic) para absorber 429 del tier 1. Llave (scope, cache_key) donde cache_key es sha256 del contenido fuente. Llenado sólo por service role desde Edge Functions.';
