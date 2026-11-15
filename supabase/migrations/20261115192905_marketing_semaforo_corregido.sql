-- Corrección PREVENTIVA de mk_semaforo_semana (escritura 2 de la Entrega 2). Mismo nombre, mismos argumentos y mismo resultado.
-- Defecto: la función une cada pieza con sus resultados de corte '7d' y 'acumulado'. Si una pieza tiene los dos de la misma fuente,
-- cuenta DOS veces (dos valores distintos en el promedio y una pieza de más en el conteo). Hoy no ocurre (todo es 'acumulado' del
-- Calendario Maestro); ocurre desde que una pieza de Metricool tenga su corte de 7 días y conserve su fila acumulada.
-- Corrección: una fila por pieza y red; se toma el valor del corte '7d' si existe y, si no, el 'acumulado'. Una fila con valor
-- nulo no gana a una que sí tiene valor. Todo lo demás (regla vigente, cobertura, motivos de gris, colores) queda igual.
CREATE OR REPLACE FUNCTION public.mk_semaforo_semana(p_org uuid, p_semana date, p_red text, p_fuente text DEFAULT 'metricool'::text)
RETURNS TABLE(piezas integer, promedio numeric, color text, motivo_gris text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT count(*), avg(x.valor)
  INTO v_n, v_prom
  FROM (
    SELECT DISTINCT ON (r.id) r.id, res.valor
    FROM public.mk_pieza p
    JOIN public.mk_pieza_red r ON r.pieza_id = p.id AND r.red = p_red AND r.estado = 'publicada'
    LEFT JOIN public.mk_resultado res
      ON res.pieza_red_id = r.id AND res.corte IN ('7d', 'acumulado') AND res.fuente = p_fuente
    WHERE p.organization_id = p_org
      AND p.primera_publicacion_at IS NOT NULL
      AND public.mk_semana_inicio(p.primera_publicacion_at) = p_semana
    ORDER BY r.id, (res.valor IS NOT NULL) DESC, (res.corte = '7d') DESC NULLS LAST
  ) x;

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
$function$;

-- Mismo cierre de permisos que el resto de funciones mk_* sensibles: solo service_role.
REVOKE ALL ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) TO service_role;
