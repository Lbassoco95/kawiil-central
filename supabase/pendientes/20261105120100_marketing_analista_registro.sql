-- Marketing: registrar al Analista de resultados y guardar sus consultas. NO SE APLICA sin confirmación de Dirección
-- (requiere antes 20261105191631_marketing_analista_datos.sql, ya aplicada y las migraciones de registro de corridas ya aplicadas).
--
-- 1) Agente `marketing_analista` en agent_registry (kind 'system', sin modelo declarado, solo lectura), igual que los otros tres.
-- 2) Tabla mk_consulta: cada pregunta al Analista con su respuesta, si las cifras se verificaron, qué herramientas usó (nombre y número
--    de filas, nunca el contenido), tokens y duración. Sirve para auditar y para los topes de uso. Solo la escribe service_role;
--    la leen quienes tienen el permiso de ver Marketing (mk_can_view) de su organización. Nada para anon.
-- 3) mk_registrar_corrida y mk_latido_agente aceptan también `marketing_analista` (misma lógica de siempre; solo cambia la lista permitida).
-- Reversa: tools/marketing/rollback_analista_registro.sql

INSERT INTO public.agent_registry (organization_id, name, display_name, description, role, status, kind, model, capabilities, config)
VALUES ('00000000-0000-0000-0000-000000000001', 'marketing_analista', 'Analista de resultados',
        'Responde cómo van las piezas (alcance, guardados, clics por red, formato y pilar), el colchón, el semáforo y los casos, citando siempre la fuente y la fecha de corte.',
        'marketing_analista', 'idle', 'system', NULL,
        '["responder_preguntas","comparar_semanas","explicar_semaforo"]'::jsonb,
        '{"modulo":"marketing","solo_lectura":true,"funcion":"marketing-agente","cadencia":"bajo_demanda","horario_legible":"cuando se le pregunta","objetivo":"Responder con cifras de la base, con fuente y fecha de corte, sin inventar ninguna.","metas":{"cifras_verificadas":true},"avisos":"solo panel"}'::jsonb)
ON CONFLICT (organization_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mk_consulta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  agente text NOT NULL DEFAULT 'marketing_analista' CHECK (agente IN ('marketing_analista')),
  pregunta text NOT NULL CHECK (char_length(pregunta) BETWEEN 3 AND 500),
  respuesta text,
  estado text NOT NULL CHECK (estado IN ('respondida', 'error', 'rechazada_limite')),
  verificada boolean,
  no_verificadas jsonb NOT NULL DEFAULT '[]'::jsonb,
  herramientas jsonb NOT NULL DEFAULT '[]'::jsonb,
  modelo text,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_salida integer NOT NULL DEFAULT 0,
  duracion_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mk_consulta_org_fecha ON public.mk_consulta (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mk_consulta_usuario_fecha ON public.mk_consulta (user_id, created_at DESC);

ALTER TABLE public.mk_consulta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mk_consulta_lectura ON public.mk_consulta;
CREATE POLICY mk_consulta_lectura ON public.mk_consulta FOR SELECT TO authenticated
  USING (public.mk_can_view() AND organization_id = public.mk_org_id());
REVOKE ALL ON public.mk_consulta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mk_consulta TO authenticated;
GRANT ALL ON public.mk_consulta TO service_role;

-- Las dos funciones de registro de corridas: misma definición, con el cuarto agente permitido.
CREATE OR REPLACE FUNCTION public.mk_registrar_corrida(
  p_agente text, p_estado text, p_titulo text, p_resumen text,
  p_resultado jsonb DEFAULT '{}'::jsonb, p_inicio timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ag record;
  v_tarea uuid;
BEGIN
  IF p_estado NOT IN ('completed', 'error') THEN
    RAISE EXCEPTION 'mk_registrar_corrida: estado no permitido: %', p_estado;
  END IF;

  SELECT id, organization_id INTO v_ag
  FROM public.agent_registry
  WHERE name = p_agente AND kind = 'system'
    AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mk_registrar_corrida: agente no permitido o no registrado: %', p_agente;
  END IF;

  INSERT INTO public.agent_tasks (organization_id, agent_id, task_type, title, priority, status, started_at, completed_at, result, result_summary, input_context)
  VALUES (v_ag.organization_id, v_ag.id, 'scheduled', left(COALESCE(NULLIF(trim(p_titulo), ''), 'Corrida de Marketing'), 200), 'normal', p_estado,
          LEAST(COALESCE(p_inicio, now()), now()), now(), COALESCE(p_resultado, '{}'::jsonb), left(COALESCE(p_resumen, ''), 300),
          jsonb_build_object('origen', 'marketing', 'agente', p_agente))
  RETURNING id INTO v_tarea;

  UPDATE public.agent_registry
  SET last_heartbeat = now(), last_task_at = now(),
      tasks_completed = COALESCE(tasks_completed, 0) + CASE WHEN p_estado = 'completed' THEN 1 ELSE 0 END,
      tasks_failed = COALESCE(tasks_failed, 0) + CASE WHEN p_estado = 'error' THEN 1 ELSE 0 END,
      status = CASE WHEN p_estado = 'error' THEN 'error' ELSE 'idle' END,
      updated_at = now()
  WHERE id = v_ag.id;

  RETURN v_tarea;
END;
$$;

CREATE OR REPLACE FUNCTION public.mk_latido_agente(p_agente text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.agent_registry SET last_heartbeat = now(), updated_at = now()
  WHERE name = p_agente AND kind = 'system' AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mk_latido_agente: agente no permitido o no registrado: %', p_agente;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_latido_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_latido_agente(text) TO service_role;
