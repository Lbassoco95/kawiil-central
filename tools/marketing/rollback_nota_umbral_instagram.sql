-- Reversa de la nota del umbral de Instagram (migración marketing_nota_umbral_instagram): devuelve la descripción original y borra su entrada de bitácora.
-- Solo actúa si la descripción actual es la original + la nota; si no, no toca nada.
DO $$
DECLARE
  v_org constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_antes constant text := 'Promedio simple por pieza de la semana, a 7 días.';
  v_filas integer;
BEGIN
  UPDATE public.mk_regla SET descripcion = v_antes
  WHERE organization_id = v_org AND codigo = 'semaforo_instagram' AND version = 1 AND descripcion LIKE v_antes || ' Nota del 15 nov 2026:%';
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN RAISE EXCEPTION 'reversa: la descripción no es la esperada (filas %)', v_filas; END IF;
  DELETE FROM public.mk_bitacora WHERE organization_id = v_org AND accion = 'nota_regla:semaforo_instagram';
END;
$$;
