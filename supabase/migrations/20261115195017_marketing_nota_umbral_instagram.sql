-- APLICADA en producción el 15 nov 2026 (versión 20261115195017), con confirmación de Dirección.
-- Registra la decisión del 15 nov 2026 (mantener los umbrales de Instagram en 35 / 15) como nota en la descripción de la regla.
-- NO cambia parámetros, versión ni colores, y no pasa por mk_cambiar_regla (que exige la sesión de Dirección con el permiso marketing_decidir
-- y solo cambia parámetros). No toca mk_regla_historial. Escribe solo: 1 fila de mk_regla (descripcion) y 1 fila nueva en mk_bitacora.
-- Condición de seguridad: solo actúa si la descripción sigue siendo exactamente la que hay hoy; si alguien la cambió, aborta sin escribir.
-- Reversa: tools/marketing/rollback_nota_umbral_instagram.sql. Propuesta y datos: docs/marketing-umbrales-instagram-propuesta.md.
DO $$
DECLARE
  v_org   constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_antes constant text := 'Promedio simple por pieza de la semana, a 7 días.';
  v_nota  constant text :=
    'Nota del 15 nov 2026: el umbral inicial (verde desde 35, amarillo desde 15) se calculó con 26 piezas del 8 de septiembre al 29 de octubre (media 35.7, mediana 15). '
    || 'Con 43 piezas de Metricool del 31 de julio al 29 de octubre (alcance acumulado a la fecha de lectura; media 46, mediana 30) Dirección decidió mantenerlo: '
    || 'las piezas forman dos grupos (8 a 20 y 37 a 167 de alcance), la mediana cae entre ellos y no es estable, y el acumulado no es comparable entre piezas de distinta edad. '
    || 'Mientras no haya corte a 7 días se usa el acumulado. Se revisa el 30 de noviembre con los cortes de 48 horas y 7 días; el cambio lo aprueba Dirección.';
  v_filas integer;
BEGIN
  UPDATE public.mk_regla
  SET descripcion = v_antes || ' ' || v_nota
  WHERE organization_id = v_org AND codigo = 'semaforo_instagram' AND version = 1 AND descripcion = v_antes;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'nota del umbral de Instagram: no se escribió (filas %, la descripción o la versión ya no son las esperadas)', v_filas;
  END IF;
  INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle)
  VALUES (v_org, 'sistema', 'nota_regla:semaforo_instagram', 'nota registrada; parámetros y versión sin cambios (35 / 15, v1)',
          jsonb_build_object('decision', 'mantener 35 / 15', 'decidido_por', 'Dirección', 'fecha', '2026-11-15', 'descripcion_anterior', v_antes,
                             'propuesta', 'docs/marketing-umbrales-instagram-propuesta.md'));
END;
$$;
