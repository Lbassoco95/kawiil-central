-- Reversa de 20261115193119_marketing_recalcular_semaforo.sql: restaura las filas de mk_calibracion desde la foto previa que guardó la bitácora
-- (la ÚLTIMA entrada 'recalculo_semaforo' por cada semana y red) y borra la función. Si hubo varios recálculos, restaura al estado previo al primero:
-- por eso toma, por semana y red, la foto más antigua.
BEGIN;
WITH fotos AS (
  SELECT DISTINCT ON (f->>'semana_inicio', f->>'red') f
  FROM public.mk_bitacora b, jsonb_array_elements(b.detalle->'antes') f
  WHERE b.accion = 'recalculo_semaforo'
  ORDER BY f->>'semana_inicio', f->>'red', b.registrado_at ASC
)
UPDATE public.mk_calibracion c SET
  piezas_calculadas = (f->>'piezas_calculadas')::integer, promedio_calculado = (f->>'promedio_calculado')::numeric, color_calculado = f->>'color_calculado',
  motivo_gris = f->>'motivo_gris', diferencia = (f->>'diferencia')::numeric, nota = f->>'nota', calculado_at = (f->>'calculado_at')::timestamptz
FROM fotos WHERE c.id = (f->>'id')::uuid;
DROP FUNCTION IF EXISTS public.mk_recalcular_semaforo(uuid, date, date, text[], text);
COMMIT;
