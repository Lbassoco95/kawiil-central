-- Marketing: recalcular el semáforo semanal con otra fuente (Metricool). NO SE APLICA sin confirmación de Dirección.
-- Requiere antes 20261115192905_marketing_semaforo_corregido.sql (mk_semaforo_semana corregida: una fila por pieza, 7d si existe y si no acumulado).
--
-- mk_recalcular_semaforo(p_org, p_desde, p_hasta, p_redes, p_fuente): para cada semana (lunes a domingo, hora de Ciudad de México) y red pedidas
-- calcula el semáforo con mk_semaforo_semana y lo escribe en mk_calibracion (una fila por semana y red; la crea si no existe).
--   · Actualiza SOLO las columnas calculadas: piezas_calculadas, promedio_calculado, color_calculado, motivo_gris, diferencia, nota y calculado_at.
--   · Conserva las columnas del archivo (piezas_calendario, promedio_calendario, color_calendario) y la nota anterior (se antepone «Recalculado con …»).
--   · diferencia = promedio calculado − promedio del archivo (solo si el archivo trae cifra de esa semana).
--   · ANTES de escribir guarda en mk_bitacora una foto de las filas que va a tocar (detalle.antes) para poder restaurarlas.
--   · Devuelve cuántas filas escribió y en cuáles cambió el color.
-- Solo service_role. Máximo 60 semanas por llamada. No toca otras redes, otras semanas, casos ni reglas.
-- Reversa: tools/marketing/rollback_recalcular_semaforo.sql (restaura las filas desde la bitácora y borra la función).

CREATE OR REPLACE FUNCTION public.mk_recalcular_semaforo(p_org uuid, p_desde date, p_hasta date, p_redes text[], p_fuente text DEFAULT 'metricool')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_desde date;
  v_antes jsonb;
  v_cambios jsonb := '[]'::jsonb;
  v_filas integer := 0;
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  s date;
  r text;
  x record;
  v_old text;
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'mk_recalcular_semaforo: falta la organización'; END IF;
  IF p_fuente IS NULL OR p_fuente NOT IN ('metricool', 'calendario_maestro') THEN RAISE EXCEPTION 'mk_recalcular_semaforo: fuente no válida: %', p_fuente; END IF;
  IF p_redes IS NULL OR cardinality(p_redes) = 0 OR EXISTS (SELECT 1 FROM unnest(p_redes) q WHERE q IS NULL OR q NOT IN ('instagram', 'facebook', 'linkedin')) THEN
    RAISE EXCEPTION 'mk_recalcular_semaforo: redes no válidas';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_desde > p_hasta THEN RAISE EXCEPTION 'mk_recalcular_semaforo: periodo no válido'; END IF;
  v_desde := public.mk_semana_inicio(p_desde::timestamp AT TIME ZONE 'America/Mexico_City');
  IF ((p_hasta - v_desde) / 7) + 1 > 60 THEN RAISE EXCEPTION 'mk_recalcular_semaforo: demasiadas semanas (máximo 60)'; END IF;

  -- Foto de lo que se va a tocar, antes de tocarlo.
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.semana_inicio, c.red), '[]'::jsonb) INTO v_antes
  FROM public.mk_calibracion c
  WHERE c.organization_id = p_org AND c.semana_inicio BETWEEN v_desde AND p_hasta AND c.red = ANY (p_redes);
  INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle)
  VALUES (p_org, 'sistema', 'recalculo_semaforo', 'foto previa al recálculo del semáforo con ' || p_fuente || ': ' || jsonb_array_length(v_antes) || ' filas',
          jsonb_build_object('fuente', p_fuente, 'desde', v_desde, 'hasta', p_hasta, 'redes', to_jsonb(p_redes), 'antes', v_antes));

  FOR s IN SELECT g::date FROM generate_series(v_desde::timestamp, p_hasta::timestamp, interval '7 days') g LOOP
    FOREACH r IN ARRAY p_redes LOOP
      SELECT * INTO x FROM public.mk_semaforo_semana(p_org, s, r, p_fuente);
      SELECT color_calculado INTO v_old FROM public.mk_calibracion WHERE organization_id = p_org AND semana_inicio = s AND red = r;
      INSERT INTO public.mk_calibracion (organization_id, semana_inicio, red, piezas_calculadas, promedio_calculado, color_calculado, motivo_gris, nota)
      VALUES (p_org, s, r, x.piezas, x.promedio, x.color, x.motivo_gris, 'Recalculado con ' || p_fuente || ' (acumulado a la fecha de lectura) el ' || v_hoy || '.')
      ON CONFLICT (organization_id, semana_inicio, red) DO UPDATE SET
        piezas_calculadas = EXCLUDED.piezas_calculadas,
        promedio_calculado = EXCLUDED.promedio_calculado,
        color_calculado = EXCLUDED.color_calculado,
        motivo_gris = EXCLUDED.motivo_gris,
        diferencia = CASE WHEN public.mk_calibracion.promedio_calendario IS NOT NULL AND EXCLUDED.promedio_calculado IS NOT NULL
                          THEN EXCLUDED.promedio_calculado - public.mk_calibracion.promedio_calendario END,
        nota = left(EXCLUDED.nota || COALESCE(' Antes: ' || NULLIF(public.mk_calibracion.nota, ''), ''), 400),
        calculado_at = now();
      v_filas := v_filas + 1;
      IF v_old IS DISTINCT FROM x.color THEN
        v_cambios := v_cambios || jsonb_build_object('semana', s, 'red', r, 'antes', v_old, 'despues', x.color);
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('fuente', p_fuente, 'filas', v_filas, 'cambios', v_cambios);
END;
$$;

REVOKE ALL ON FUNCTION public.mk_recalcular_semaforo(uuid, date, date, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_recalcular_semaforo(uuid, date, date, text[], text) TO service_role;
