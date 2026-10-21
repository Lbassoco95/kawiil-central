-- Mejora búsqueda aproximada de conceptos SAT (texto general → ClaveProdServ).
-- Añade ILIKE / word_similarity además de trgm % y FTS.

CREATE OR REPLACE FUNCTION public.portal_sat_catalog_suggest(
  _catalog text,
  _q text,
  _limit integer DEFAULT 12
)
RETURNS TABLE (clave text, descripcion text, score real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      lower(trim(coalesce(_q, ''))) AS term,
      regexp_replace(trim(coalesce(_q, '')), '[^0-9A-Za-z]', '', 'g') AS alnum,
      regexp_replace(trim(coalesce(_q, '')), '[^0-9]', '', 'g') AS digits
  )
  SELECT e.clave, e.descripcion,
    greatest(
      similarity(e.search_text, q.term),
      word_similarity(q.term, e.search_text),
      CASE WHEN q.digits <> '' AND e.clave LIKE q.digits || '%' THEN 0.95 ELSE 0 END,
      CASE WHEN q.term <> '' AND e.search_text ILIKE '%' || q.term || '%' THEN 0.85 ELSE 0 END,
      ts_rank(
        to_tsvector('spanish', e.search_text),
        plainto_tsquery('spanish', coalesce(nullif(q.term, ''), 'x'))
      )
    )::real AS score
  FROM public.sat_catalog_entries e
  CROSS JOIN q
  WHERE e.catalog = _catalog
    AND e.active
    AND q.term <> ''
    AND (
      e.search_text % q.term
      OR word_similarity(q.term, e.search_text) > 0.35
      OR (q.alnum <> '' AND e.clave LIKE q.alnum || '%')
      OR e.search_text ILIKE '%' || q.term || '%'
      OR to_tsvector('spanish', e.search_text) @@ plainto_tsquery('spanish', q.term)
    )
  ORDER BY score DESC, e.clave
  LIMIT greatest(1, least(coalesce(_limit, 12), 40));
$$;

COMMENT ON FUNCTION public.portal_sat_catalog_suggest(text, text, integer) IS
  'Suggest aproximado ClaveProdServ/unidad: trgm, word_similarity, ILIKE y FTS.';
