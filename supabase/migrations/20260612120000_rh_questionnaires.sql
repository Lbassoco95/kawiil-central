-- =============================================================
-- RH — Motor de cuestionarios (NOM-035 y clima organizacional)
-- Modelo CONFIDENCIAL: se registra quién respondió (para seguimiento),
-- pero las respuestas individuales solo las ve el propio colaborador.
-- Los resultados para G4 se obtienen agregados vía RPC (SECURITY DEFINER).
--
-- NOTA: el contenido de la NOM-035 (Guía de Referencia II) se siembra como
-- punto de partida EDITABLE. Verifica el texto e inversión de ítems y los
-- rangos contra el documento oficial del DOF antes de aplicarlo formalmente.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rh_questionnaires (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'custom',     -- nom035 | clima | custom
  title           text NOT NULL,
  description     text,
  scale           jsonb NOT NULL DEFAULT '[]',        -- [{label, value}]
  bands           jsonb NOT NULL DEFAULT '[]',        -- [{level,label,color,min}] sobre el total
  higher_is_better boolean NOT NULL DEFAULT false,    -- clima: true; nom035 (riesgo): false
  active          boolean NOT NULL DEFAULT false,     -- ¿abierto para responder?
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rh_questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  questionnaire_id uuid NOT NULL REFERENCES public.rh_questionnaires(id) ON DELETE CASCADE,
  category         text,
  domain           text,
  text             text NOT NULL,
  reverse          boolean NOT NULL DEFAULT false,    -- ítem positivo: el puntaje se invierte
  position         integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rh_questions_q ON public.rh_questions(questionnaire_id, position);

CREATE TABLE IF NOT EXISTS public.rh_survey_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  questionnaire_id uuid NOT NULL REFERENCES public.rh_questionnaires(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (questionnaire_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.rh_survey_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES public.rh_survey_responses(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.rh_questions(id) ON DELETE CASCADE,
  value       integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rh_answers_resp ON public.rh_survey_answers(response_id);

ALTER TABLE public.rh_questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_survey_answers ENABLE ROW LEVEL SECURITY;

-- Cuestionarios y preguntas: la org los lee; G4 los administra.
DROP POLICY IF EXISTS "Org reads questionnaires" ON public.rh_questionnaires;
CREATE POLICY "Org reads questionnaires" ON public.rh_questionnaires
  FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS "G4 manages questionnaires" ON public.rh_questionnaires;
CREATE POLICY "G4 manages questionnaires" ON public.rh_questionnaires
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

DROP POLICY IF EXISTS "Org reads questions" ON public.rh_questions;
CREATE POLICY "Org reads questions" ON public.rh_questions
  FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS "G4 manages questions" ON public.rh_questions;
CREATE POLICY "G4 manages questions" ON public.rh_questions
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- Respuestas: el dueño gestiona la suya; G4 ve los encabezados (quién respondió),
-- pero NO las respuestas individuales.
DROP POLICY IF EXISTS "Owner manages own response" ON public.rh_survey_responses;
CREATE POLICY "Owner manages own response" ON public.rh_survey_responses
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS "G4 sees who responded" ON public.rh_survey_responses;
CREATE POLICY "G4 sees who responded" ON public.rh_survey_responses
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- Respuestas a ítems: SOLO el dueño (confidencialidad). G4 usa el RPC agregado.
DROP POLICY IF EXISTS "Owner manages own answers" ON public.rh_survey_answers;
CREATE POLICY "Owner manages own answers" ON public.rh_survey_answers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rh_survey_responses r WHERE r.id = response_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rh_survey_responses r WHERE r.id = response_id AND r.user_id = auth.uid()));

-- =============================================================
-- RPC de resultados agregados (solo G4). Devuelve promedios por categoría
-- y total; nunca respuestas individuales. El puntaje de "riesgo" invierte
-- los ítems positivos (reverse) sobre una escala 0..4.
-- =============================================================
CREATE OR REPLACE FUNCTION public.rh_questionnaire_results(_qid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid;
  _respondents int;
  _total_avg numeric;
  _total_max int;
  _cats jsonb;
BEGIN
  SELECT organization_id INTO _org FROM public.rh_questionnaires WHERE id = _qid;
  IF _org IS NULL THEN RETURN NULL; END IF;
  IF NOT (public.get_user_org_id(auth.uid()) = _org AND public.has_role(auth.uid(), 'transformador')) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  SELECT count(*) INTO _respondents FROM public.rh_survey_responses WHERE questionnaire_id = _qid;
  SELECT count(*) * 4 INTO _total_max FROM public.rh_questions WHERE questionnaire_id = _qid;

  -- Puntaje por respuesta (sumando ítems con inversión), luego promedio.
  WITH scored AS (
    SELECT r.id AS response_id,
           q.category,
           CASE WHEN q.reverse THEN 4 - a.value ELSE a.value END AS s
    FROM public.rh_survey_responses r
    JOIN public.rh_survey_answers a ON a.response_id = r.id
    JOIN public.rh_questions q ON q.id = a.question_id
    WHERE r.questionnaire_id = _qid
  ),
  per_resp AS (
    SELECT response_id, sum(s) AS total FROM scored GROUP BY response_id
  ),
  per_cat AS (
    SELECT category,
           sum(s)::numeric / NULLIF(count(DISTINCT response_id), 0) AS avg_score,
           (count(*) / NULLIF(count(DISTINCT response_id), 0)) * 4 AS max_score
    FROM scored GROUP BY category
  )
  SELECT
    (SELECT round(avg(total), 1) FROM per_resp),
    (SELECT jsonb_agg(jsonb_build_object(
       'category', category,
       'avg', round(avg_score, 1),
       'max', max_score,
       'pct', CASE WHEN max_score > 0 THEN round((avg_score / max_score) * 100) ELSE 0 END
     ) ORDER BY category) FROM per_cat)
  INTO _total_avg, _cats;

  RETURN jsonb_build_object(
    'respondents', _respondents,
    'total_avg', COALESCE(_total_avg, 0),
    'total_max', COALESCE(_total_max, 0),
    'categories', COALESCE(_cats, '[]'::jsonb)
  );
END $$;

-- =============================================================
-- SEEDS por organización: NOM-035 (Guía II) y Clima organizacional.
-- =============================================================
DO $$
DECLARE
  o record;
  qid uuid;
  freq jsonb := '[{"label":"Siempre","value":4},{"label":"Casi siempre","value":3},{"label":"Algunas veces","value":2},{"label":"Casi nunca","value":1},{"label":"Nunca","value":0}]';
  agree jsonb := '[{"label":"Totalmente de acuerdo","value":4},{"label":"De acuerdo","value":3},{"label":"Ni de acuerdo ni en desacuerdo","value":2},{"label":"En desacuerdo","value":1},{"label":"Totalmente en desacuerdo","value":0}]';
  nom_bands jsonb := '[{"level":"nulo","label":"Nulo o despreciable","color":"emerald","min":0},{"level":"bajo","label":"Bajo","color":"emerald","min":20},{"level":"medio","label":"Medio","color":"amber","min":45},{"level":"alto","label":"Alto","color":"red","min":70},{"level":"muy_alto","label":"Muy alto","color":"red","min":90}]';
  cats text[];
  doms text[];
  txts text[];
  revs boolean[];
  i int;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    -- ---------- NOM-035 Guía II ----------
    IF NOT EXISTS (SELECT 1 FROM public.rh_questionnaires WHERE organization_id = o.id AND type = 'nom035') THEN
      INSERT INTO public.rh_questionnaires (organization_id, type, title, description, scale, bands, higher_is_better, active)
      VALUES (o.id, 'nom035',
        'NOM-035 · Factores de riesgo psicosocial (Guía II)',
        'Cuestionario de la Guía de Referencia II (16–50 personas). Contenido editable: verifica el texto oficial del DOF.',
        freq, nom_bands, false, false)
      RETURNING id INTO qid;

      cats := ARRAY[
        'Ambiente de trabajo','Ambiente de trabajo','Ambiente de trabajo',
        'Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad',
        'Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad','Factores propios de la actividad',
        'Organización del tiempo de trabajo','Organización del tiempo de trabajo','Organización del tiempo de trabajo','Organización del tiempo de trabajo','Organización del tiempo de trabajo','Organización del tiempo de trabajo',
        'Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo',
        'Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo',
        'Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo',
        'Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo','Liderazgo y relaciones en el trabajo'
      ];
      doms := ARRAY[
        'Condiciones en el ambiente de trabajo','Condiciones en el ambiente de trabajo','Condiciones en el ambiente de trabajo',
        'Carga de trabajo','Carga de trabajo','Carga de trabajo','Carga de trabajo','Carga de trabajo','Carga de trabajo','Carga de trabajo',
        'Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo','Falta de control sobre el trabajo',
        'Jornada de trabajo','Jornada de trabajo','Interferencia trabajo-familia','Interferencia trabajo-familia','Interferencia trabajo-familia','Interferencia trabajo-familia',
        'Liderazgo','Liderazgo','Liderazgo','Liderazgo',
        'Relaciones en el trabajo','Relaciones en el trabajo','Relaciones en el trabajo','Relaciones en el trabajo','Relaciones en el trabajo',
        'Violencia','Violencia','Violencia','Violencia','Violencia','Violencia','Violencia',
        'Violencia','Violencia','Violencia'
      ];
      txts := ARRAY[
        'El espacio donde trabajo me permite realizar mis actividades de manera segura e higiénica',
        'Mi trabajo me exige hacer mucho esfuerzo físico',
        'Me preocupa sufrir un accidente en mi trabajo',
        'Por la cantidad de trabajo que tengo debo quedarme tiempo adicional a mi turno',
        'Por la cantidad de trabajo que tengo debo trabajar sin parar',
        'Considero que es necesario mantener un ritmo de trabajo acelerado',
        'Mi trabajo exige que esté muy concentrado',
        'Mi trabajo requiere que memorice mucha información',
        'En mi trabajo tengo que tomar decisiones difíciles muy rápido',
        'Mi trabajo exige que atienda varios asuntos al mismo tiempo',
        'En mi trabajo soy responsable de cosas de mucho valor',
        'Respondo ante mi jefe por los resultados de toda mi área de trabajo',
        'En el trabajo me dan órdenes contradictorias',
        'Considero que en mi trabajo me piden hacer cosas innecesarias',
        'Mi trabajo me permite desarrollar nuevas habilidades',
        'En mi trabajo puedo aportar mis conocimientos y experiencia',
        'Mi trabajo me da la oportunidad de hacer las cosas como considero que es mejor',
        'Puedo decidir cuánto trabajo realizo durante la jornada laboral',
        'Puedo decidir la velocidad a la que realizo mis actividades',
        'Puedo cambiar el orden de las actividades que realizo en mi trabajo',
        'Trabajo horas extras más de tres veces a la semana',
        'Mi trabajo me exige laborar en días de descanso, festivos o fines de semana',
        'Considero que el tiempo en el trabajo es mucho y perjudica mis actividades familiares o personales',
        'Debo atender asuntos de trabajo cuando estoy en casa',
        'Pienso en las actividades familiares o personales cuando estoy en mi trabajo',
        'Pienso en las actividades laborales cuando estoy con mi familia',
        'Mi jefe tiene en cuenta mis puntos de vista y opiniones',
        'Mi jefe me comunica a tiempo la información relacionada con el trabajo',
        'La orientación que me da mi jefe me ayuda a realizar mejor mi trabajo',
        'Mi jefe ayuda a solucionar los problemas que se presentan en el trabajo',
        'Puedo confiar en mis compañeros de trabajo',
        'Entre compañeros solucionamos los problemas de trabajo de forma respetuosa',
        'En mi trabajo me hacen sentir parte del grupo',
        'Cuando tenemos que realizar trabajo en equipo mis compañeros colaboran',
        'Mis compañeros de trabajo me ayudan cuando tengo dificultades',
        'Recibo críticas constantes a mi persona o a mi trabajo',
        'Recibo burlas, calumnias, difamaciones, humillaciones o ridiculizaciones',
        'Se ignora mi presencia o se me excluye de las reuniones y de la toma de decisiones',
        'Se manipulan las situaciones de trabajo para hacerme parecer un mal trabajador',
        'Se ignoran mis logros y se atribuyen a otras personas',
        'Me bloquean o impiden las oportunidades para obtener un ascenso o mejora',
        'He presenciado actos de violencia en mi centro de trabajo',
        'Recibo presiones para trabajar menos y de mala calidad',
        'He sido víctima de acoso u hostigamiento en mi centro de trabajo',
        'Me asignan cargas de trabajo excesivas como forma de presión'
      ];
      revs := ARRAY[
        true,false,false,
        false,false,false,false,false,false,false,
        false,false,false,false,true,true,true,true,true,true,
        false,false,false,false,false,false,
        true,true,true,true,
        true,true,true,true,true,
        false,false,false,false,false,false,false,
        false,false,false
      ];
      FOR i IN 1 .. array_length(txts, 1) LOOP
        INSERT INTO public.rh_questions (organization_id, questionnaire_id, category, domain, text, reverse, position)
        VALUES (o.id, qid, cats[i], doms[i], txts[i], revs[i], i);
      END LOOP;
    END IF;

    -- ---------- Clima organizacional ----------
    IF NOT EXISTS (SELECT 1 FROM public.rh_questionnaires WHERE organization_id = o.id AND type = 'clima') THEN
      INSERT INTO public.rh_questionnaires (organization_id, type, title, description, scale, bands, higher_is_better, active)
      VALUES (o.id, 'clima',
        'Evaluación de clima organizacional',
        'Encuesta de percepción del ambiente laboral. Escala de acuerdo.',
        agree, '[]'::jsonb, true, false)
      RETURNING id INTO qid;

      cats := ARRAY[
        'Comunicación','Comunicación','Liderazgo','Liderazgo','Reconocimiento','Reconocimiento',
        'Trabajo en equipo','Trabajo en equipo','Desarrollo','Desarrollo','Condiciones','Condiciones','Satisfacción','Satisfacción'
      ];
      txts := ARRAY[
        'La comunicación con mi líder es clara y oportuna',
        'En el equipo se comparte la información necesaria para trabajar bien',
        'Mi líder me da retroalimentación que me ayuda a mejorar',
        'Confío en las decisiones de mi líder',
        'Mi trabajo es reconocido y valorado',
        'Siento que mi esfuerzo se recompensa de forma justa',
        'Mis compañeros colaboran y se apoyan entre sí',
        'Me siento parte del equipo',
        'Tengo oportunidades de aprender y crecer en la empresa',
        'Recibo la capacitación que necesito para mi trabajo',
        'Cuento con las herramientas y recursos para hacer bien mi trabajo',
        'Mi carga de trabajo es razonable',
        'En general, me siento satisfecho trabajando aquí',
        'Recomendaría a la empresa como un buen lugar para trabajar'
      ];
      FOR i IN 1 .. array_length(txts, 1) LOOP
        INSERT INTO public.rh_questions (organization_id, questionnaire_id, category, domain, text, reverse, position)
        VALUES (o.id, qid, cats[i], cats[i], txts[i], false, i);
      END LOOP;
    END IF;
  END LOOP;
END $$;
