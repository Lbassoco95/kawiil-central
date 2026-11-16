-- Marketing: agente «Comunicación interna» y avisos al entrar. APLICADA en producción el 16 nov 2026 (versión 20261116221334) con confirmación de Dirección.
-- NOTA: la comprobación «¿ya está en la lista?» del bloque final usa una búsqueda de texto que coincidió con el nombre de OTRO agente (marketing_comunicacion_interna, de otra sesión,
-- aplicado 2 segundos antes) y por eso no agregó `marketing_comunicacion` a mk_registrar_corrida y mk_latido_agente. Se corrigió en 20261116223934_marketing_comunicacion_listas_agentes.sql.
-- Requiere antes 20261116164704_marketing_investigador.sql (ya aplicada) y la tabla internal_comunicados (ya existe, vacía en producción al 16 nov).
--
-- Decisión de Dirección (16 nov): el equipo se entera SOLO dentro del sistema (aviso al abrirlo y la pestaña Comunicados del Hub), y Dirección aprueba cada comunicado.
--
-- 1) internal_comunicados gana: estado (borrador / publicado / archivado), origen (persona / agente), vigencia por fechas, «avisar al entrar» y la aprobación.
--    Lo que ya existe (y lo que publiquen personas con el formulario actual) queda igual: estado «publicado», origen «persona», sin vigencia.
--    Un comunicado redactado con el agente NUNCA queda publicado sin aprobación: la base exige aprobado_at, que solo pone ic_publicar() (solo Dirección).
-- 2) Lectura: los miembros de la organización ven solo lo publicado; los borradores y archivados los ven admin/manager y quien tiene el permiso de decidir en Marketing.
--    (Producción tiene DOS políticas de lectura que se suman; se reemplazan las dos.)
-- 3) Funciones para la pantalla (solo Dirección, permiso marketing_decidir): ic_crear_borrador, ic_publicar, ic_archivar, ic_descartar_borrador.
-- 4) Agente `marketing_comunicacion` en agent_registry (kind 'system', bajo demanda, solo propone) y alta en mk_consulta, mk_registrar_corrida y mk_latido_agente.
--    Las listas permitidas se amplían LEYENDO la definición vigente en la base (no se copian a mano): así no se pisa a otro agente que otra migración haya agregado.
-- No borra ni cambia datos existentes. Reversa: tools/marketing/rollback_comunicacion_interna.sql

-- 1) Columnas y restricciones --------------------------------------------------------------------------------------------------
ALTER TABLE public.internal_comunicados
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'publicado',
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'persona',
  ADD COLUMN IF NOT EXISTS vigente_desde date,
  ADD COLUMN IF NOT EXISTS vigente_hasta date,
  ADD COLUMN IF NOT EXISTS avisar_al_entrar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aprobado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobado_at timestamptz;

ALTER TABLE public.internal_comunicados DROP CONSTRAINT IF EXISTS ic_estado_check;
ALTER TABLE public.internal_comunicados ADD CONSTRAINT ic_estado_check CHECK (estado IN ('borrador', 'publicado', 'archivado'));
ALTER TABLE public.internal_comunicados DROP CONSTRAINT IF EXISTS ic_origen_check;
ALTER TABLE public.internal_comunicados ADD CONSTRAINT ic_origen_check CHECK (origen IN ('persona', 'agente'));
-- La vigencia viene completa (desde y hasta), en orden y de a lo más un año.
ALTER TABLE public.internal_comunicados DROP CONSTRAINT IF EXISTS ic_vigencia_check;
ALTER TABLE public.internal_comunicados ADD CONSTRAINT ic_vigencia_check CHECK (
  (vigente_desde IS NULL AND vigente_hasta IS NULL)
  OR (vigente_desde IS NOT NULL AND vigente_hasta IS NOT NULL AND vigente_hasta >= vigente_desde AND vigente_hasta - vigente_desde <= 366));
ALTER TABLE public.internal_comunicados DROP CONSTRAINT IF EXISTS ic_avisar_requiere_vigencia;
ALTER TABLE public.internal_comunicados ADD CONSTRAINT ic_avisar_requiere_vigencia CHECK (NOT avisar_al_entrar OR vigente_desde IS NOT NULL);
-- Un comunicado del agente no puede estar publicado sin una aprobación registrada.
ALTER TABLE public.internal_comunicados DROP CONSTRAINT IF EXISTS ic_agente_requiere_aprobacion;
ALTER TABLE public.internal_comunicados ADD CONSTRAINT ic_agente_requiere_aprobacion CHECK (origen <> 'agente' OR estado <> 'publicado' OR aprobado_at IS NOT NULL);
ALTER TABLE public.internal_comunicados DROP CONSTRAINT IF EXISTS ic_agente_limites;
ALTER TABLE public.internal_comunicados ADD CONSTRAINT ic_agente_limites CHECK (origen <> 'agente' OR (char_length(title) BETWEEN 1 AND 200 AND char_length(coalesce(body, '')) <= 4000));

CREATE INDEX IF NOT EXISTS idx_internal_comunicados_aviso ON public.internal_comunicados (organization_id, vigente_desde, vigente_hasta)
  WHERE estado = 'publicado' AND avisar_al_entrar;

-- 2) Lectura: solo lo publicado para el equipo --------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Org members can view internal comunicados" ON public.internal_comunicados;
DROP POLICY IF EXISTS "Org users see internal_comunicados" ON public.internal_comunicados;
DROP POLICY IF EXISTS "Org users see published internal_comunicados" ON public.internal_comunicados;
CREATE POLICY "Org users see published internal_comunicados" ON public.internal_comunicados FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (estado = 'publicado' OR public.is_admin_or_manager(auth.uid()) OR public.mk_can_decide())
  );

-- 3) Funciones de la pantalla (solo Dirección) --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ic_crear_borrador(p_titulo text, p_mensaje text, p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL, p_avisar boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_id uuid;
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_msg text := btrim(coalesce(p_mensaje, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.mk_can_decide() THEN RAISE EXCEPTION 'Solo Dirección puede guardar borradores de comunicados' USING ERRCODE = '42501'; END IF;
  v_org := public.get_user_org_id(auth.uid());
  IF v_org IS NULL THEN RAISE EXCEPTION 'No se encontró tu organización'; END IF;
  IF char_length(v_titulo) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'El título debe tener entre 1 y 200 caracteres'; END IF;
  IF char_length(v_msg) > 4000 THEN RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 4000 caracteres)'; END IF;
  IF (p_desde IS NULL) <> (p_hasta IS NULL) THEN RAISE EXCEPTION 'La vigencia necesita fecha de inicio y de fin'; END IF;
  IF coalesce(p_avisar, false) AND p_desde IS NULL THEN RAISE EXCEPTION 'Para avisar al entrar hace falta indicar las fechas'; END IF;
  IF p_desde IS NOT NULL AND (p_hasta < p_desde OR p_hasta - p_desde > 366) THEN RAISE EXCEPTION 'La vigencia no es válida (fin antes del inicio o más de un año)'; END IF;
  INSERT INTO public.internal_comunicados (organization_id, title, body, estado, origen, vigente_desde, vigente_hasta, avisar_al_entrar, created_by)
  VALUES (v_org, v_titulo, NULLIF(v_msg, ''), 'borrador', 'agente', p_desde, p_hasta, coalesce(p_avisar, false), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ic_publicar(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_c public.internal_comunicados%ROWTYPE;
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.mk_can_decide() THEN RAISE EXCEPTION 'Solo Dirección puede publicar comunicados' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_c FROM public.internal_comunicados WHERE id = p_id AND organization_id = public.get_user_org_id(auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró ese comunicado'; END IF;
  IF v_c.estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se pueden publicar borradores'; END IF;
  IF v_c.vigente_hasta IS NOT NULL AND v_c.vigente_hasta < v_hoy THEN RAISE EXCEPTION 'La vigencia ya terminó: pide un comunicado con fechas nuevas'; END IF;
  UPDATE public.internal_comunicados SET estado = 'publicado', aprobado_por = auth.uid(), aprobado_at = now() WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ic_archivar(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.mk_can_decide() THEN RAISE EXCEPTION 'Solo Dirección puede retirar comunicados' USING ERRCODE = '42501'; END IF;
  UPDATE public.internal_comunicados SET estado = 'archivado' WHERE id = p_id AND organization_id = public.get_user_org_id(auth.uid()) AND estado = 'publicado';
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró un comunicado publicado con ese id'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ic_descartar_borrador(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.mk_can_decide() THEN RAISE EXCEPTION 'Solo Dirección puede descartar borradores' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.internal_comunicados WHERE id = p_id AND organization_id = public.get_user_org_id(auth.uid()) AND estado = 'borrador';
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró un borrador con ese id'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ic_crear_borrador(text, text, date, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ic_publicar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ic_archivar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ic_descartar_borrador(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ic_crear_borrador(text, text, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ic_publicar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ic_archivar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ic_descartar_borrador(uuid) TO authenticated;

-- 4) El agente --------------------------------------------------------------------------------------------------------------------
INSERT INTO public.agent_registry (organization_id, name, display_name, description, role, status, kind, model, capabilities, config)
VALUES ('00000000-0000-0000-0000-000000000001', 'marketing_comunicacion', 'Comunicación interna',
        'Redacta comunicados para el equipo de Kawiil (por ejemplo, un día no laborable) y propone que se muestren como aviso al abrir el sistema. Solo redacta y propone: cada comunicado lo aprueba Dirección y se ve únicamente dentro del sistema.',
        'marketing_comunicacion', 'idle', 'system', NULL,
        '["redactar_comunicados","proponer_avisos_al_entrar"]'::jsonb,
        '{"modulo":"marketing","solo_lectura":true,"funcion":"marketing-agente","cadencia":"bajo_demanda","horario_legible":"cuando se le pide","objetivo":"Redactar comunicados internos claros para el equipo y proponer su vigencia; Dirección los aprueba y se ven solo dentro del sistema.","metas":{"aprobacion_de_direccion":true},"avisos":"solo dentro del sistema"}'::jsonb)
ON CONFLICT (organization_id, name) DO NOTHING;

-- mk_consulta.agente: se agrega el agente a la lista que haya hoy en la restricción.
DO $$
DECLARE
  v_def text;
  v_lista text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.mk_consulta'::regclass AND conname = 'mk_consulta_agente_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe mk_consulta_agente_check'; END IF;
  IF v_def LIKE '%marketing_comunicacion%' THEN RETURN; END IF;
  SELECT string_agg(quote_literal(m[1]), ', ') INTO v_lista FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF v_lista IS NULL THEN RAISE EXCEPTION 'no se encontró la lista de agentes en %', v_def; END IF;
  ALTER TABLE public.mk_consulta DROP CONSTRAINT mk_consulta_agente_check;
  EXECUTE format('ALTER TABLE public.mk_consulta ADD CONSTRAINT mk_consulta_agente_check CHECK (agente IN (%s, %L))', v_lista, 'marketing_comunicacion');
END;
$$;

-- mk_registrar_corrida y mk_latido_agente: se agrega el agente a la lista «name IN (...)» de la definición vigente (se conservan los demás agentes y los permisos).
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_nuevo text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.mk_registrar_corrida(text,text,text,text,jsonb,timestamptz)', 'public.mk_latido_agente(text)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def LIKE '%marketing_comunicacion%' THEN CONTINUE; END IF;
    v_nuevo := regexp_replace(v_def, '(\mname IN \([^)]*)\)', '\1, ''marketing_comunicacion'')');
    IF v_nuevo = v_def THEN RAISE EXCEPTION 'no se encontró la lista de agentes en %', v_fn; END IF;
    EXECUTE v_nuevo;
  END LOOP;
END;
$$;
