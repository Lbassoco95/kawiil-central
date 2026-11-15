-- Reversa de la carga histórica de resultados de Metricool (13–15 nov 2026). Solo para ANTES de que existan lecturas diarias de Metricool:
-- borra TODOS los resultados de fuente 'metricool', las filas de mk_pieza_red que la carga creó (sus ids están en la bitácora) y la cobertura 'metricool'.
-- No toca el Calendario Maestro (fuente 'calendario_maestro'), los casos, las reglas ni los agentes. Borrar una fila de mk_pieza_red borra en cascada sus resultados.
BEGIN;
DELETE FROM public.mk_resultado WHERE fuente = 'metricool';
DELETE FROM public.mk_pieza_red
WHERE id IN (
  SELECT (jsonb_array_elements_text(detalle->'piezas_red_creadas'))::uuid
  FROM public.mk_bitacora WHERE accion = 'carga_resultados'
);
DELETE FROM public.mk_cobertura_fuente WHERE fuente = 'metricool';
COMMIT;
