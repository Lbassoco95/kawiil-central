-- Marketing: cierres de seguridad 1, 3 y 4 (confirmados por Dirección el 31 oct 2026).
-- No incluye el cierre 2 (GraphQL), que se decide al construir la interfaz.

-- 1. Ruta de búsqueda fija.
ALTER FUNCTION public.mk_solo_insercion() SET search_path = public, pg_temp;
ALTER FUNCTION public.mk_semana_inicio(timestamptz) SET search_path = public, pg_temp;

-- 3 y 4. Funciones privilegiadas que no deben ser llamables desde la API.
-- Quedan ejecutables solo por el propietario y service_role.
REVOKE ALL ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_sembrar_reglas_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mk_recalcular_primera_publicacion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_semaforo_semana(uuid, date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mk_sembrar_reglas_v1(uuid) TO service_role;
-- Siguen abiertas a authenticated: mk_can_view, mk_can_decide, mk_org_id, mk_cambiar_regla, mk_decidir_propuesta.
