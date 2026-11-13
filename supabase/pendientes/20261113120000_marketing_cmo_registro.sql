-- Marketing: registrar al CMO (director de marketing). NO SE APLICA sin confirmación de Dirección.
-- Requiere antes 20261105194055_marketing_analista_registro.sql (ya aplicada).
--
-- 1) Agente `marketing_cmo` en agent_registry (kind 'system', bajo demanda, solo lectura y propone: lo que sugiere lo decide una persona).
-- 2) mk_consulta.agente admite también 'marketing_cmo' (cada consulta guarda con qué agente se habló).
-- 3) mk_registrar_corrida y mk_latido_agente aceptan también `marketing_cmo` (misma lógica de siempre; solo cambia la lista permitida).
-- No toca datos existentes. Reversa: tools/marketing/rollback_cmo_registro.sql

INSERT INTO public.agent_registry (organization_id, name, display_name, description, role, status, kind, model, capabilities, config)
VALUES ('00000000-0000-0000-0000-000000000001', 'marketing_cmo', 'Director de marketing (CMO)',
        'Coordina al equipo de marketing: lee los resultados, los casos y el colchón, y propone qué priorizar, quién lo haría y qué se mediría. Solo propone: cada propuesta la decide una persona.',
        'marketing_cmo', 'idle', 'system', NULL,
        '["panorama","priorizar","proponer_siguientes_pasos"]'::jsonb,
        '{"modulo":"marketing","solo_lectura":true,"funcion":"marketing-agente","cadencia":"bajo_demanda","horario_legible":"cuando se le pregunta","objetivo":"Dar a Dirección un panorama con cifras de la base y proponer qué priorizar, con responsable y cómo se mediría, sin ejecutar nada.","metas":{"cifras_verificadas":true},"avisos":"solo panel"}'::jsonb)
ON CONFLICT (organization_id, name) DO NOTHING;

ALTER TABLE public.mk_consulta DROP CONSTRAINT IF EXISTS mk_consulta_agente_check;
ALTER TABLE public.mk_consulta ADD CONSTRAINT mk_consulta_agente_check CHECK (agente IN ('marketing_analista', 'marketing_cmo'));

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
    AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista', 'marketing_cmo')
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
  WHERE name = p_agente AND kind = 'system' AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista', 'marketing_cmo');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mk_latido_agente: agente no permitido o no registrado: %', p_agente;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_latido_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_latido_agente(text) TO service_role;
