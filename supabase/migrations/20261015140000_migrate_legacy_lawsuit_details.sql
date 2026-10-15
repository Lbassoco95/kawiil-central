-- Pasa los juicios de la versión anterior (projects.lawsuit_details) al nuevo control
-- «Juicios y trámites» (project_lawsuits). No destructivo: el JSON original se conserva
-- en projects.lawsuit_details_legacy y solo entonces se limpia lawsuit_details.
-- Idempotente: si lawsuit_details ya es NULL (o ya se migró) no hace nada.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS lawsuit_details_legacy jsonb;

DO $$
DECLARE
  p record;
  ld jsonb;
  v_stages jsonb;
  v_current text;
  v_hearing date;
  v_deadline date;
  v_deadline_note text;
  v_notes text;
  v_case text;
  v_exists boolean;
BEGIN
  FOR p IN
    SELECT id, name, organization_id, created_by, lawsuit_details
    FROM public.projects
    WHERE lawsuit_details IS NOT NULL
      AND jsonb_typeof(lawsuit_details) = 'object'
  LOOP
    ld := p.lawsuit_details;
    v_case := NULLIF(btrim(ld->>'case_number'), '');

    -- ¿Ya está registrado en el nuevo control (mismo expediente o mismo nombre)?
    SELECT EXISTS (
      SELECT 1 FROM public.project_lawsuits l
      WHERE l.project_id = p.id
        AND ((v_case IS NOT NULL AND l.case_number = v_case) OR lower(btrim(l.name)) = lower(btrim(p.name)))
    ) INTO v_exists;

    IF NOT v_exists THEN
      -- Etapas: «completado» pasa a completed=true; «no_aplica» se omite.
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                 'key', COALESCE(NULLIF(t.s->>'key', ''), 'etapa-' || t.ord),
                 'label', t.s->>'label',
                 'completed', (t.s->>'status') = 'completado',
                 'completed_at', CASE
                   WHEN (t.s->>'status') = 'completado' AND (t.s->>'completed_at') ~ '^\d{4}-\d{2}-\d{2}'
                   THEN left(t.s->>'completed_at', 10)
                   ELSE NULL
                 END
               ) ORDER BY t.ord), '[]'::jsonb)
        INTO v_stages
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(ld->'stages') = 'array' THEN ld->'stages' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(s, ord)
      WHERE t.s->>'label' IS NOT NULL
        AND COALESCE(t.s->>'status', '') <> 'no_aplica';

      SELECT e.v->>'label' INTO v_current
      FROM jsonb_array_elements(v_stages) WITH ORDINALITY AS e(v, ord)
      WHERE (e.v->>'completed')::boolean = false
      ORDER BY e.ord
      LIMIT 1;

      -- Plazos: la audiencia pendiente más próxima y el plazo/entrega pendiente más próximo.
      v_hearing := NULL; v_deadline := NULL; v_deadline_note := NULL;
      IF jsonb_typeof(ld->'deadlines') = 'array' THEN
        SELECT min((d->>'date')::date) INTO v_hearing
        FROM jsonb_array_elements(ld->'deadlines') AS d
        WHERE d->>'type' = 'audiencia'
          AND COALESCE((d->>'completed')::boolean, false) = false
          AND (d->>'date') ~ '^\d{4}-\d{2}-\d{2}$';

        SELECT (d->>'date')::date, d->>'title' INTO v_deadline, v_deadline_note
        FROM jsonb_array_elements(ld->'deadlines') AS d
        WHERE COALESCE(d->>'type', '') <> 'audiencia'
          AND COALESCE((d->>'completed')::boolean, false) = false
          AND (d->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
        ORDER BY (d->>'date')::date
        LIMIT 1;
      END IF;

      -- Datos que el nuevo modelo no tiene como columna: van en las notas.
      v_notes := NULLIF(concat_ws(E'\n',
        CASE WHEN NULLIF(ld->>'lead_attorney', '') IS NOT NULL THEN 'Abogado titular: ' || (ld->>'lead_attorney') END,
        CASE WHEN NULLIF(ld->>'substitute_attorney', '') IS NOT NULL THEN 'Abogado sustituto: ' || (ld->>'substitute_attorney') END,
        CASE WHEN jsonb_typeof(ld->'authorized_persons') = 'array' AND jsonb_array_length(ld->'authorized_persons') > 0
             THEN 'Autorizados: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(ld->'authorized_persons') AS x) END
      ), '');

      INSERT INTO public.project_lawsuits (
        organization_id, project_id, name, lawsuit_type, case_number, court, plaintiff, defendant,
        status, current_stage, stages, next_hearing_date, next_deadline_date, next_deadline_note,
        notes, created_by
      ) VALUES (
        p.organization_id, p.id, p.name, NULLIF(ld->>'lawsuit_type', ''), v_case,
        NULLIF(ld->>'court', ''), NULLIF(ld->>'plaintiff', ''), NULLIF(ld->>'defendant', ''),
        'en_tramite', v_current, v_stages, v_hearing, v_deadline, v_deadline_note,
        v_notes, p.created_by
      );
    END IF;

    -- Respaldo del original y limpieza para que la app deje de leer el modelo anterior.
    UPDATE public.projects
    SET lawsuit_details_legacy = lawsuit_details,
        lawsuit_details = NULL
    WHERE id = p.id;
  END LOOP;
END $$;
