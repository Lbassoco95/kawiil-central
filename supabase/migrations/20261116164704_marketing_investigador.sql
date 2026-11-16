-- Marketing: Investigador web (propuesta §14.3). APLICADA en producción el 16 nov 2026 con confirmación de Dirección (versión 20261116164704).
-- Requiere antes 20261113015847_marketing_cmo_registro.sql (ya aplicada).
--
-- 1) mk_fuente_web: LISTA CERRADA de páginas y fuentes de noticias que el Investigador puede leer. La escribe Dirección (service_role); los usuarios solo leen.
--    Empieza VACÍA: sin fuentes, el agente no lee nada. Solo https; el sitio exacto de cada url es el único que se pide.
--    El agente también puede PROPONER fuentes (estado «propuesta», inactivas, con motivo): una persona las aprueba o las rechaza. Las rechazadas se conservan para no volver a proponerlas.
-- 2) mk_hallazgo_web: lo que encontró (cambio en una página o nota nueva de un feed): título, resumen corto, enlace y fecha. Nunca el texto completo de la página.
--    Único por (fuente, huella): repetir una corrida no duplica hallazgos.
-- 3) Agente `marketing_investigador` en agent_registry (kind 'system', solo lectura, bajo demanda hasta que se programe).
-- 4) mk_registrar_corrida y mk_latido_agente aceptan también `marketing_investigador` (misma lógica; solo cambia la lista permitida).
-- No toca datos existentes. Reversa: tools/marketing/rollback_investigador.sql

CREATE TABLE IF NOT EXISTS public.mk_fuente_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('propio', 'competencia', 'noticias')),
  formato text NOT NULL DEFAULT 'pagina' CHECK (formato IN ('pagina', 'feed')),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  url text NOT NULL CHECK (char_length(url) <= 500 AND url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^[:space:]]*)?$'),
  temas text[] NOT NULL DEFAULT '{}' CHECK (cardinality(temas) <= 20),
  activa boolean NOT NULL DEFAULT true,
  -- Quién la puso y en qué estado está. El agente solo PROPONE: sus filas nacen «propuesta» e inactivas y una persona las aprueba (estado «activa» + aprobada_at).
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('propuesta', 'activa', 'rechazada')),
  origen text NOT NULL DEFAULT 'direccion' CHECK (origen IN ('direccion', 'agente')),
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 300),
  verificada_at timestamptz,
  aprobada_at timestamptz,
  ultima_lectura_at timestamptz,
  ultima_huella text,
  ultimo_resumen text CHECK (ultimo_resumen IS NULL OR char_length(ultimo_resumen) <= 600),
  ultimo_estado text CHECK (ultimo_estado IS NULL OR char_length(ultimo_estado) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, url),
  -- Solo una fuente aprobada se lee, y una fuente del agente no puede estar activa sin una aprobación registrada.
  CONSTRAINT mk_fuente_web_activa_requiere_estado CHECK (NOT activa OR estado = 'activa'),
  CONSTRAINT mk_fuente_web_agente_requiere_aprobacion CHECK (origen <> 'agente' OR estado <> 'activa' OR aprobada_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.mk_hallazgo_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  fuente_id uuid NOT NULL REFERENCES public.mk_fuente_web (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('cambio_pagina', 'nota_nueva')),
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  resumen text NOT NULL DEFAULT '' CHECK (char_length(resumen) <= 600),
  enlace text NOT NULL CHECK (char_length(enlace) <= 500 AND enlace ~ '^https://'),
  publicado_at timestamptz,
  huella text NOT NULL,
  encontrado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fuente_id, huella)
);
CREATE INDEX IF NOT EXISTS mk_hallazgo_web_org_fecha ON public.mk_hallazgo_web (organization_id, encontrado_at DESC);

ALTER TABLE public.mk_fuente_web ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk_hallazgo_web ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mk_fuente_web_lectura ON public.mk_fuente_web;
CREATE POLICY mk_fuente_web_lectura ON public.mk_fuente_web FOR SELECT TO authenticated
  USING (public.mk_can_view() AND organization_id = public.mk_org_id());
DROP POLICY IF EXISTS mk_hallazgo_web_lectura ON public.mk_hallazgo_web;
CREATE POLICY mk_hallazgo_web_lectura ON public.mk_hallazgo_web FOR SELECT TO authenticated
  USING (public.mk_can_view() AND organization_id = public.mk_org_id());
REVOKE ALL ON public.mk_fuente_web, public.mk_hallazgo_web FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mk_fuente_web, public.mk_hallazgo_web TO authenticated;
GRANT ALL ON public.mk_fuente_web, public.mk_hallazgo_web TO service_role;

INSERT INTO public.agent_registry (organization_id, name, display_name, description, role, status, kind, model, capabilities, config)
VALUES ('00000000-0000-0000-0000-000000000001', 'marketing_investigador', 'Investigador web',
        'Lee la lista cerrada de páginas y noticias aprobadas (sitio propio, competencia, noticias) y deja hallazgos con su fuente y fecha. También busca fuentes nuevas y las propone; una persona decide cuáles activar. Solo lee; no inicia sesión ni escribe en ningún sitio.',
        'marketing_investigador', 'idle', 'system', NULL,
        '["vigilar_sitio_propio","vigilar_competencia","leer_noticias","proponer_fuentes"]'::jsonb,
        '{"modulo":"marketing","solo_lectura":true,"funcion":"marketing-investigador","cadencia":"bajo_demanda","horario_legible":"cuando se programe","objetivo":"Avisar de cambios en el sitio propio y la competencia y de noticias del sector, con resumen corto, enlace y fecha, sin guardar texto completo ni inventar.","metas":{"con_fuente":true},"avisos":"solo panel"}'::jsonb)
ON CONFLICT (organization_id, name) DO NOTHING;

-- Las dos funciones de registro de corridas: misma definición, con el Investigador permitido.
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
    AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista', 'marketing_cmo', 'marketing_investigador')
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
  WHERE name = p_agente AND kind = 'system' AND name IN ('marketing_vigilante', 'marketing_informe_diario', 'marketing_vigia', 'marketing_analista', 'marketing_cmo', 'marketing_investigador');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mk_latido_agente: agente no permitido o no registrado: %', p_agente;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_latido_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_registrar_corrida(text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_latido_agente(text) TO service_role;
