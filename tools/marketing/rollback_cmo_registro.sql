-- Reversa de 20261113015847_marketing_cmo_registro.sql: quita al CMO (y sus consultas), y devuelve las funciones y la restricción a como estaban con el Analista.
DELETE FROM public.mk_consulta WHERE agente = 'marketing_cmo';
ALTER TABLE public.mk_consulta DROP CONSTRAINT IF EXISTS mk_consulta_agente_check;
ALTER TABLE public.mk_consulta ADD CONSTRAINT mk_consulta_agente_check CHECK (agente = 'marketing_analista');
DELETE FROM public.agent_tasks WHERE agent_id IN (SELECT id FROM public.agent_registry WHERE name = 'marketing_cmo');
DELETE FROM public.agent_registry WHERE name = 'marketing_cmo';

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
