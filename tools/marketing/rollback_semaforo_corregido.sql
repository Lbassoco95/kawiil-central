-- Reversa de 20261115192905_marketing_semaforo_corregido.sql (aplicada con su versión real): vuelve a la definición de 20261031205319.
CREATE OR REPLACE FUNCTION public.mk_semaforo_semana(
  p_org uuid,
  p_semana date,
  p_red text,
  p_fuente text DEFAULT 'metricool'
)
RETURNS TABLE (piezas integer, promedio numeric, color text, motivo_gris text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_verde numeric;
  v_amarillo numeric;
  v_n integer;
  v_prom numeric;
  v_cubierta boolean;
BEGIN
  SELECT (parametros->>'verde_desde')::numeric, (parametros->>'amarillo_desde')::numeric
  INTO v_verde, v_amarillo
  FROM public.mk_regla WHERE organization_id = p_org AND codigo = 'semaforo_' || p_red AND activa;

  SELECT count(*), avg(res.valor)
  INTO v_n, v_prom
  FROM public.mk_pieza p
  JOIN public.mk_pieza_red r ON r.pieza_id = p.id AND r.red = p_red AND r.estado = 'publicada'
  LEFT JOIN public.mk_resultado res
    ON res.pieza_red_id = r.id AND res.corte IN ('7d', 'acumulado') AND res.fuente = p_fuente
  WHERE p.organization_id = p_org
    AND p.primera_publicacion_at IS NOT NULL
    AND public.mk_semana_inicio(p.primera_publicacion_at) = p_semana;

  -- ¿La fuente cubre esta semana para esta red?
  SELECT EXISTS (
    SELECT 1 FROM public.mk_cobertura_fuente c
    WHERE c.organization_id = p_org AND c.red = p_red AND c.fuente = p_fuente
      AND c.desde <= p_semana + 6 AND c.hasta >= p_semana
  ) INTO v_cubierta;

  RETURN QUERY SELECT
    v_n,
    v_prom,
    CASE
      WHEN v_n = 0 OR v_prom IS NULL OR v_verde IS NULL THEN 'gris'
      WHEN v_prom >= v_verde THEN 'verde'
      WHEN v_prom >= v_amarillo THEN 'amarillo'
      ELSE 'rojo'
    END,
    CASE
      WHEN v_n > 0 AND v_prom IS NOT NULL AND v_verde IS NOT NULL THEN NULL
      WHEN NOT v_cubierta THEN 'sin_datos_fuente'
      ELSE 'sin_piezas_publicadas'
    END;
END;
$$;
REVOKE ALL ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) TO service_role;
