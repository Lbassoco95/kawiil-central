-- Marketing: el CMO y el Analista pueden ver el estado real del equipo (herramienta «estado_equipo»). NO SE APLICA sin confirmación de Dirección.
-- Requiere antes 20261105191631_marketing_analista_datos.sql (ya aplicada). Es la misma función con UNA herramienta más; las demás no cambian.
-- Reversa: tools/marketing/rollback_estado_equipo.sql (vuelve a la definición de 20261105191631).

CREATE OR REPLACE FUNCTION public.mk_analista_datos(p_org uuid, p_herramienta text, p_entrada jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_semanas integer := LEAST(GREATEST(COALESCE((p_entrada->>'semanas')::integer, 8), 1), 26);
  v_dias integer := LEAST(GREATEST(COALESCE((p_entrada->>'dias')::integer, 90), 1), 365);
  v_red text := NULLIF(p_entrada->>'red', '');
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_res jsonb;
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'mk_analista_datos: falta la organización'; END IF;
  IF v_red IS NOT NULL AND v_red NOT IN ('instagram', 'facebook', 'linkedin') THEN
    RAISE EXCEPTION 'mk_analista_datos: red no válida: %', v_red;
  END IF;

  IF p_herramienta = 'colchon_actual' THEN
    -- Última lectura real (no simulada) de cada red.
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.red), '[]'::jsonb) INTO v_res FROM (
      SELECT DISTINCT ON (c.red) c.red, c.fecha, c.ultima_programada, c.dias, c.color, c.programadas
      FROM public.mk_colchon c WHERE c.organization_id = p_org AND NOT c.simulada
      ORDER BY c.red, c.fecha DESC, c.corrida_at DESC) t;

  ELSIF p_herramienta = 'resultados_semanales' THEN
    -- Por semana de publicación y red: piezas y métricas. Una fila por pieza y red.
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.semana_inicio DESC, t.red, t.medida), '[]'::jsonb) INTO v_res FROM (
      WITH base AS (
        SELECT DISTINCT ON (r.pieza_red_id) r.*, pr.red, pr.publicada_at
        FROM public.mk_resultado r JOIN public.mk_pieza_red pr ON pr.id = r.pieza_red_id
        WHERE r.organization_id = p_org AND pr.publicada_at IS NOT NULL AND (v_red IS NULL OR pr.red = v_red)
        ORDER BY r.pieza_red_id, (r.valor IS NOT NULL) DESC, (r.corte = '7d') DESC, (r.fuente = 'metricool') DESC, r.capturado_at DESC)
      SELECT public.mk_semana_inicio(publicada_at) AS semana_inicio, red, medida, count(*)::integer AS piezas,
             round(avg(valor) FILTER (WHERE valor IS NOT NULL), 1) AS valor_promedio,
             COALESCE(sum(guardados), 0)::integer AS guardados, COALESCE(sum(compartidos), 0)::integer AS compartidos,
             COALESCE(sum(clics), 0)::integer AS clics, COALESCE(sum(reacciones), 0)::integer AS reacciones, COALESCE(sum(comentarios), 0)::integer AS comentarios
      FROM base WHERE public.mk_semana_inicio(publicada_at) >= (v_hoy - (v_semanas * 7))
      GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3 LIMIT 60) t;

  ELSIF p_herramienta IN ('resultados_por_formato', 'resultados_por_pilar') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.red, t.medida, t.piezas DESC), '[]'::jsonb) INTO v_res FROM (
      WITH base AS (
        SELECT DISTINCT ON (r.pieza_red_id) r.*, pr.red, pr.publicada_at, p.formato, p.pilar
        FROM public.mk_resultado r JOIN public.mk_pieza_red pr ON pr.id = r.pieza_red_id JOIN public.mk_pieza p ON p.id = pr.pieza_id
        WHERE r.organization_id = p_org AND pr.publicada_at IS NOT NULL AND pr.publicada_at >= (now() - make_interval(days => v_dias)) AND (v_red IS NULL OR pr.red = v_red)
        ORDER BY r.pieza_red_id, (r.valor IS NOT NULL) DESC, (r.corte = '7d') DESC, (r.fuente = 'metricool') DESC, r.capturado_at DESC)
      SELECT red, medida,
             CASE WHEN p_herramienta = 'resultados_por_formato' THEN COALESCE(formato, '(sin formato)') ELSE COALESCE(pilar, '(sin pilar)') END AS grupo,
             count(*)::integer AS piezas, round(avg(valor) FILTER (WHERE valor IS NOT NULL), 1) AS valor_promedio,
             round(avg(guardados), 1) AS guardados_promedio, round(avg(compartidos), 1) AS compartidos_promedio, round(avg(clics), 1) AS clics_promedio
      FROM base GROUP BY red, medida, 3 ORDER BY red, medida, piezas DESC LIMIT 60) t;

  ELSIF p_herramienta = 'semaforo_semanas' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.semana_inicio DESC, t.red), '[]'::jsonb) INTO v_res FROM (
      SELECT semana_inicio, red, piezas_calculadas, promedio_calculado, color_calculado, color_calendario, motivo_gris, diferencia
      FROM public.mk_calibracion WHERE organization_id = p_org AND semana_inicio >= (v_hoy - (v_semanas * 7)) AND (v_red IS NULL OR red = v_red)
      ORDER BY semana_inicio DESC, red LIMIT 60) t;

  ELSIF p_herramienta = 'casos_abiertos' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.numero), '[]'::jsonb) INTO v_res FROM (
      SELECT numero, tipo, red, left(titulo, 120) AS titulo, estado, detectado_at::date AS detectado
      FROM public.mk_caso WHERE organization_id = p_org AND estado <> 'cerrado' ORDER BY numero LIMIT 60) t;

  ELSIF p_herramienta = 'informe_hoy' THEN
    -- Último informe real: solo conteos y las piezas que faltan (código, fecha, hora, redes). Sin textos de recomendación.
    SELECT COALESCE(to_jsonb(t), '{}'::jsonb) INTO v_res FROM (
      SELECT i.fecha,
             COALESCE(jsonb_array_length(i.contenido->'faltantes'), 0) AS faltantes,
             COALESCE(jsonb_array_length(i.contenido->'con_error'), 0) AS con_error,
             COALESCE(jsonb_array_length(i.contenido->'desconocidos'), 0) AS desconocidos,
             COALESCE((i.contenido->>'piezas_calendario_en_ventana')::integer, 0) AS piezas_en_ventana,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('codigo', f->>'codigo', 'fecha', f->>'fecha', 'hora', f->>'hora', 'redes', f->'redes'))
                       FROM jsonb_array_elements(i.contenido->'faltantes') f), '[]'::jsonb) AS piezas_faltantes
      FROM public.mk_informe_diario i WHERE i.organization_id = p_org AND NOT i.simulada ORDER BY i.fecha DESC, i.created_at DESC LIMIT 1) t;
    v_res := COALESCE(v_res, '{}'::jsonb);

  ELSIF p_herramienta = 'piezas_proximas' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.fecha, t.codigo), '[]'::jsonb) INTO v_res FROM (
      SELECT p.codigo, p.fecha, p.pilar, p.formato,
             (SELECT count(*)::integer FROM public.mk_pieza_red pr WHERE pr.pieza_id = p.id AND pr.estado = 'publicada') AS redes_publicada,
             (SELECT count(*)::integer FROM public.mk_pieza_red pr WHERE pr.pieza_id = p.id) AS redes_total
      FROM public.mk_pieza p WHERE p.organization_id = p_org AND p.fecha >= v_hoy AND p.fecha <= v_hoy + LEAST(v_dias, 60) ORDER BY p.fecha, p.codigo LIMIT 60) t;

  ELSIF p_herramienta = 'reglas_vigentes' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.codigo), '[]'::jsonb) INTO v_res FROM (
      SELECT codigo, nombre, parametros, version FROM public.mk_regla WHERE organization_id = p_org AND activa ORDER BY codigo LIMIT 60) t;

  ELSIF p_herramienta = 'cobertura_fuentes' THEN
    -- Desde cuándo hay datos de cada red y fuente: sirve para avisar de límites antes de comparar periodos.
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.red, t.fuente), '[]'::jsonb) INTO v_res FROM (
      SELECT red, fuente, desde, hasta FROM public.mk_cobertura_fuente WHERE organization_id = p_org ORDER BY red, fuente LIMIT 60) t;

  ELSIF p_herramienta = 'estado_equipo' THEN
    -- Estado real de cada agente de Marketing, por sus PROPIAS tareas. No incluye el latido (el servicio kawiil-agents lo marca a todos los agentes
    -- al mismo tiempo, así que no dice si un agente corrió) ni títulos, instrucciones o resultados completos: solo estado, conteos y el resumen corto
    -- que el propio agente deja al terminar. No hay filas de agentes ajenos a Marketing.
    SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'orden' ORDER BY t.orden), '[]'::jsonb) INTO v_res FROM (
      SELECT a.display_name AS agente, a.name AS clave,
             CASE a.name WHEN 'marketing_vigilante' THEN 1 WHEN 'marketing_informe_diario' THEN 2 WHEN 'marketing_vigia' THEN 3
                         WHEN 'marketing_analista' THEN 4 WHEN 'marketing_cmo' THEN 5 ELSE 9 END AS orden,
             COALESCE(a.config->>'cadencia', 'programado') AS cadencia, a.config->>'horario_legible' AS horario, left(a.config->>'objetivo', 200) AS objetivo,
             a.status AS estado, a.last_task_at AS ultima_tarea_en, a.tasks_completed AS tareas_completadas, a.tasks_failed AS tareas_con_error,
             (SELECT count(*)::integer FROM public.agent_tasks k WHERE k.agent_id = a.id AND k.status = 'completed' AND k.completed_at > now() - interval '7 days') AS completadas_7_dias,
             (SELECT count(*)::integer FROM public.agent_tasks k WHERE k.agent_id = a.id AND k.status = 'error' AND k.completed_at > now() - interval '7 days') AS con_error_7_dias,
             (SELECT k.status FROM public.agent_tasks k WHERE k.agent_id = a.id AND k.completed_at IS NOT NULL ORDER BY k.completed_at DESC LIMIT 1) AS ultima_tarea_estado,
             (SELECT left(k.result_summary, 160) FROM public.agent_tasks k WHERE k.agent_id = a.id AND k.completed_at IS NOT NULL ORDER BY k.completed_at DESC LIMIT 1) AS ultima_tarea_resumen
      FROM public.agent_registry a
      WHERE a.kind = 'system' AND a.name LIKE 'marketing\_%' ESCAPE '\' AND a.status <> 'archived'
      ORDER BY 3 LIMIT 20) t;

  ELSE
    RAISE EXCEPTION 'mk_analista_datos: herramienta no permitida: %', p_herramienta;
  END IF;

  RETURN jsonb_build_object('herramienta', p_herramienta, 'corte', now(), 'datos', v_res);
END;
$$;

REVOKE ALL ON FUNCTION public.mk_analista_datos(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_analista_datos(uuid, text, jsonb) TO service_role;
