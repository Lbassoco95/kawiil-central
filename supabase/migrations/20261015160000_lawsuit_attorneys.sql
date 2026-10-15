-- Abogados del juicio/trámite como campos propios (antes iban en notas al migrar).
ALTER TABLE public.project_lawsuits
  ADD COLUMN IF NOT EXISTS lead_attorney text,
  ADD COLUMN IF NOT EXISTS substitute_attorney text,
  ADD COLUMN IF NOT EXISTS authorized_persons text[] NOT NULL DEFAULT '{}';

-- Rellena desde el respaldo del modelo anterior (mismo proyecto y mismo expediente o nombre)
-- y limpia las notas solo si son exactamente el texto que generó la migración anterior.
DO $$
DECLARE
  r record;
  ld jsonb;
  v_lead text;
  v_sub text;
  v_auth text[];
  v_generated text;
BEGIN
  FOR r IN
    SELECT l.id AS lawsuit_id, l.notes, l.case_number, l.name, p.lawsuit_details_legacy AS legacy
    FROM public.project_lawsuits l
    JOIN public.projects p ON p.id = l.project_id
    WHERE p.lawsuit_details_legacy IS NOT NULL
      AND jsonb_typeof(p.lawsuit_details_legacy) = 'object'
      AND l.lead_attorney IS NULL AND l.substitute_attorney IS NULL AND l.authorized_persons = '{}'
  LOOP
    ld := r.legacy;
    IF NOT (
      (NULLIF(btrim(ld->>'case_number'), '') IS NOT NULL AND r.case_number = NULLIF(btrim(ld->>'case_number'), ''))
      OR r.notes LIKE 'Abogado titular:%' OR r.notes LIKE 'Abogado sustituto:%' OR r.notes LIKE 'Autorizados:%'
    ) THEN
      CONTINUE;
    END IF;

    v_lead := NULLIF(btrim(ld->>'lead_attorney'), '');
    v_sub := NULLIF(btrim(ld->>'substitute_attorney'), '');
    v_auth := CASE WHEN jsonb_typeof(ld->'authorized_persons') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(ld->'authorized_persons'))
                   ELSE '{}'::text[] END;

    v_generated := NULLIF(concat_ws(E'\n',
      CASE WHEN v_lead IS NOT NULL THEN 'Abogado titular: ' || v_lead END,
      CASE WHEN v_sub IS NOT NULL THEN 'Abogado sustituto: ' || v_sub END,
      CASE WHEN cardinality(v_auth) > 0 THEN 'Autorizados: ' || array_to_string(v_auth, ', ') END
    ), '');

    UPDATE public.project_lawsuits
    SET lead_attorney = v_lead,
        substitute_attorney = v_sub,
        authorized_persons = v_auth,
        notes = CASE WHEN notes = v_generated THEN NULL ELSE notes END
    WHERE id = r.lawsuit_id;
  END LOOP;
END $$;
