-- =================================================================
-- Pipeline: persona física o moral en el alta del lead
--
-- Antes el alta exigía "Nombre completo", pero muchos prospectos llegan
-- como empresa (sólo tenemos la razón social y todavía no sabemos con quién
-- hablaremos). Con `person_type` el formulario pide los datos que
-- corresponden a cada caso.
--
-- `leads.full_name` sigue siendo NOT NULL porque es lo que se muestra en el
-- tablero, la lista y los correos. La regla de captura es:
--   - persona física  → full_name = nombre de la persona
--   - persona moral   → full_name = nombre del contacto; si aún no hay
--                       contacto, la razón social (company_name)
-- =================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS person_type text
    CHECK (person_type IS NULL OR person_type IN ('fisica', 'moral')),
  ADD COLUMN IF NOT EXISTS contact_role text;

COMMENT ON COLUMN public.leads.person_type IS
  'fisica | moral. Define qué campos pide el alta y la ficha del lead. NULL = leads anteriores a este campo.';
COMMENT ON COLUMN public.leads.contact_role IS
  'Puesto de la persona de contacto (útil en personas morales): director, socio, contador…';
