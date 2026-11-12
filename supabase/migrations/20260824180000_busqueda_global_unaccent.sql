-- =============================================================
-- Búsqueda global tolerante a acentos
-- =============================================================
-- El buscador (⌘K) consultaba cada tabla con `ilike`, que en Postgres es
-- sensible a acentos: "jose" no encontraba "José" ni "constitucion" a
-- "Constitución". En un acervo en español eso deja fuera media búsqueda.
--
-- Aquí se resuelve en la base:
--   1. unaccent + pg_trgm.
--   2. Un envoltorio IMMUTABLE de unaccent (el de la extensión es STABLE
--      porque depende del diccionario; con el diccionario explícito sí se
--      puede indexar).
--   3. Un índice GIN trigram por tabla sobre el MISMO texto concatenado que
--      luego filtra la función, para que el planificador lo pueda usar.
--   4. buscar_global(): una sola llamada en vez de cinco consultas.
--
-- La función es SECURITY INVOKER (el default; no se pone DEFINER a
-- propósito): las políticas RLS del usuario que llama siguen aplicando, así
-- que nadie ve clientes ni leads de otra organización a través del buscador.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1. unaccent indexable -------------------------------------------------
-- extensions.unaccent(text) es STABLE (resuelve el diccionario en tiempo de
-- ejecución). Pasando el diccionario explícito el resultado es determinista,
-- que es lo que permite declararla IMMUTABLE y usarla en un índice.
-- SECURITY DEFINER a propósito: la función vive en `extensions` y no todos los
-- roles tienen USAGE sobre ese esquema, así que en invoker fallaba con
-- "permission denied for schema extensions" para `authenticated`. Aquí es
-- seguro: no toca ninguna tabla, sólo normaliza una cadena, y el search_path
-- va fijo para que no se pueda secuestrar la resolución de nombres.
CREATE OR REPLACE FUNCTION public.kawiil_unaccent(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SECURITY DEFINER
SET search_path = extensions, pg_catalog
AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, txt))
$$;

COMMENT ON FUNCTION public.kawiil_unaccent(text) IS
  'unaccent + lower en versión IMMUTABLE (diccionario explícito) para poder indexarla.';

GRANT EXECUTE ON FUNCTION public.kawiil_unaccent(text) TO authenticated;

-- 2. Índices trigram ----------------------------------------------------
-- La expresión indexada debe ser IDÉNTICA a la que filtra buscar_global; si
-- se cambia una hay que cambiar la otra o el índice deja de usarse.
CREATE INDEX IF NOT EXISTS clients_busqueda_trgm
  ON public.clients USING gin (
    public.kawiil_unaccent(
      coalesce(name, '') || ' ' || coalesce(rfc, '') || ' ' ||
      coalesce(email, '') || ' ' || coalesce(contact_name, '')
    ) extensions.gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS projects_busqueda_trgm
  ON public.projects USING gin (
    public.kawiil_unaccent(coalesce(name, '') || ' ' || coalesce(description, ''))
    extensions.gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS tasks_busqueda_trgm
  ON public.tasks USING gin (
    public.kawiil_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))
    extensions.gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS documents_busqueda_trgm
  ON public.documents USING gin (
    public.kawiil_unaccent(coalesce(name, '')) extensions.gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS leads_busqueda_trgm
  ON public.leads USING gin (
    public.kawiil_unaccent(
      coalesce(full_name, '') || ' ' || coalesce(company_name, '') || ' ' ||
      coalesce(email, '')
    ) extensions.gin_trgm_ops
  );

-- 3. La búsqueda --------------------------------------------------------
DROP FUNCTION IF EXISTS public.buscar_global(text, integer, boolean);

CREATE FUNCTION public.buscar_global(
  termino text,
  limite integer DEFAULT 8,
  incluir_leads boolean DEFAULT false
)
RETURNS TABLE (
  entidad text,
  id uuid,
  titulo text,
  subtitulo text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  normalizado text;
  patron text;
  tope integer := least(greatest(coalesce(limite, 8), 1), 50);
BEGIN
  normalizado := public.kawiil_unaccent(coalesce(termino, ''));

  -- Menos de dos caracteres devolvería medio despacho; no vale la pena.
  IF normalizado IS NULL OR length(trim(normalizado)) < 2 THEN
    RETURN;
  END IF;

  -- El término es texto libre: \ % y _ son comodines de LIKE y hay que
  -- escaparlos para que "100%" o "a_b" se busquen literalmente.
  patron := '%' || replace(replace(replace(normalizado, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT * FROM (
    SELECT
      'client'::text,
      c.id,
      c.name,
      nullif(concat_ws(' · ', nullif(c.rfc, ''), nullif(c.contact_name, '')), '')
    FROM public.clients c
    WHERE public.kawiil_unaccent(
            coalesce(c.name, '') || ' ' || coalesce(c.rfc, '') || ' ' ||
            coalesce(c.email, '') || ' ' || coalesce(c.contact_name, '')
          ) LIKE patron
    ORDER BY c.name
    LIMIT tope
  ) AS clientes

  UNION ALL
  SELECT * FROM (
    SELECT 'project'::text, p.id, p.name, cli.name
    FROM public.projects p
    LEFT JOIN public.clients cli ON cli.id = p.client_id
    WHERE public.kawiil_unaccent(coalesce(p.name, '') || ' ' || coalesce(p.description, ''))
          LIKE patron
    ORDER BY p.updated_at DESC
    LIMIT tope
  ) AS proyectos

  UNION ALL
  SELECT * FROM (
    SELECT 'task'::text, t.id, t.title, coalesce(cli.name, t.status::text)
    FROM public.tasks t
    LEFT JOIN public.clients cli ON cli.id = t.client_id
    WHERE public.kawiil_unaccent(coalesce(t.title, '') || ' ' || coalesce(t.description, ''))
          LIKE patron
    ORDER BY t.created_at DESC
    LIMIT tope
  ) AS tareas

  UNION ALL
  SELECT * FROM (
    SELECT 'document'::text, d.id, d.name, cli.name
    FROM public.documents d
    LEFT JOIN public.clients cli ON cli.id = d.client_id
    WHERE public.kawiil_unaccent(coalesce(d.name, '')) LIKE patron
    ORDER BY d.created_at DESC
    LIMIT tope
  ) AS documentos

  UNION ALL
  SELECT * FROM (
    SELECT
      'lead'::text,
      l.id,
      l.full_name,
      nullif(coalesce(nullif(l.company_name, ''), nullif(l.email, '')), '')
    FROM public.leads l
    WHERE incluir_leads
      AND public.kawiil_unaccent(
            coalesce(l.full_name, '') || ' ' || coalesce(l.company_name, '') || ' ' ||
            coalesce(l.email, '')
          ) LIKE patron
    ORDER BY l.updated_at DESC
    LIMIT tope
  ) AS prospectos;
END;
$$;

COMMENT ON FUNCTION public.buscar_global(text, integer, boolean) IS
  'Búsqueda global sin acentos sobre clientes, proyectos, tareas, documentos y leads. SECURITY INVOKER: respeta las políticas RLS de quien llama.';

GRANT EXECUTE ON FUNCTION public.buscar_global(text, integer, boolean) TO authenticated;
