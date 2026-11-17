-- Comunicación interna de Kawiil: SEGUNDA aplicación del mismo archivo (versión del registro 20261116221334). Un reinicio de la sesión repitió la llamada y el registro quedó con dos
-- versiones del mismo nombre. Todo es idempotente (IF NOT EXISTS, ON CONFLICT DO NOTHING, CREATE OR REPLACE): la segunda vez no cambió nada. Se conserva el archivo para que el
-- historial del repositorio coincida con el registro de producción y `supabase db push` no encuentre una versión remota sin archivo local.
-- Contenido idéntico a 20261116221332_marketing_comunicacion_interna.sql.
--
-- 1) aviso_equipo: avisos internos para el equipo («ese día no se trabaja»). Los LEEN todos los usuarios con sesión (solo los publicados: es información
--    para todo el equipo, no de clientes); los ESCRIBE únicamente service_role, por la función comunicacion-interna, tras la aprobación de una persona de Dirección.
--    Un aviso solo se publica o se cancela: no se borra ni se edita (queda el historial).
-- 2) Agente `marketing_comunicacion_interna` en agent_registry (kind 'system'; redacta el comunicado, no publica solo; solo panel, sin correo/Slack/WhatsApp).
-- 3) mk_registrar_corrida y mk_latido_agente aceptan también `marketing_comunicacion_interna` (misma lógica; solo cambia la lista permitida).
-- Reversa: tools/marketing/rollback_comunicacion_interna.sql

CREATE TABLE IF NOT EXISTS public.aviso_equipo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  tipo text NOT NULL DEFAULT 'general' CHECK (tipo IN ('dia_inhabil', 'general')),
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 120),
  mensaje text NOT NULL CHECK (char_length(mensaje) BETWEEN 3 AND 600),
  desde date NOT NULL,
  hasta date NOT NULL,
  estado text NOT NULL DEFAULT 'publicado' CHECK (estado IN ('publicado', 'cancelado')),
  redactado_por text NOT NULL DEFAULT 'direccion' CHECK (redactado_por IN ('agente', 'direccion')),
  aprobado_por uuid,
  aprobado_at timestamptz NOT NULL DEFAULT now(),
  cancelado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta >= desde AND hasta - desde <= 31)
);
CREATE INDEX IF NOT EXISTS aviso_equipo_vigencia ON public.aviso_equipo (hasta, desde) WHERE estado = 'publicado';

ALTER TABLE public.aviso_equipo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aviso_equipo_lectura ON public.aviso_equipo;
CREATE POLICY aviso_equipo_lectura ON public.aviso_equipo FOR SELECT TO authenticated USING (estado = 'publicado');
REVOKE ALL ON public.aviso_equipo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.aviso_equipo TO authenticated;
GRANT ALL ON public.aviso_equipo TO service_role;

INSERT INTO public.agent_registry (organization_id, name, display_name, description, role, status, kind, model, capabilities, config)
VALUES ('00000000-0000-0000-0000-000000000001', 'marketing_comunicacion_interna', 'Comunicación interna',
        'Redacta los comunicados internos para el equipo de Kawiil (por ejemplo, un día en que no se trabaja) y propone el aviso con sus fechas. Una persona de Dirección aprueba antes de publicar; el aviso se ve en pantalla al entrar al sistema. No manda correo, Slack ni WhatsApp.',
        'marketing_comunicacion_interna', 'idle', 'system', NULL,
        '["redactar_comunicados","proponer_avisos"]'::jsonb,
        '{"modulo":"marketing","solo_lectura":false,"funcion":"comunicacion-interna","cadencia":"bajo_demanda","horario_legible":"cuando se le pide","objetivo":"Que el equipo se entere a tiempo de lo que cambia en la operación (días sin trabajo, avisos generales), con un mensaje claro y fechas exactas.","metas":{"con_aprobacion":true},"avisos":"solo panel"}'::jsonb)
ON CONFLICT (organization_id, name) DO NOTHING;

-- Las dos funciones de registro de corridas: misma definición, con Comunicación interna permitida.
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
    AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista', 'marketing_cmo', 'marketing_investigador', 'marketing_comunicacion_interna')
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
  WHERE name = p_agente AND kind = 'system' AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista', 'marketing_cmo', 'marketing_investigador', 'marketing_comunicacion_interna');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mk_latido_agente: agente no permitido o no registrado: %', p_agente;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_latido_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_latido_agente(text) TO service_role;
