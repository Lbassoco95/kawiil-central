-- Reversa de 20261116221334_marketing_comunicacion_interna.sql (Comunicación interna y avisos al entrar).
-- OJO: BORRA los comunicados que se redactaron con el agente (origen = 'agente', borradores y publicados) y las columnas nuevas de internal_comunicados.
-- Los comunicados publicados por personas se conservan (sin su vigencia ni su aviso al entrar). Copia antes lo que quieras guardar.
-- Las listas de agentes se devuelven quitando SOLO a `marketing_comunicacion`: se conservan los demás agentes que haya hoy.

-- Agente, su historial y sus consultas
DELETE FROM public.agent_tasks WHERE agent_id IN (SELECT id FROM public.agent_registry WHERE name = 'marketing_comunicacion');
DELETE FROM public.mk_consulta WHERE agente = 'marketing_comunicacion';
DELETE FROM public.agent_registry WHERE name = 'marketing_comunicacion';

DO $$
DECLARE
  v_def text;
  v_lista text;
  v_fn text;
  v_nuevo text;
BEGIN
  -- mk_consulta.agente: la lista actual sin marketing_comunicacion
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.mk_consulta'::regclass AND conname = 'mk_consulta_agente_check';
  IF v_def LIKE '%marketing_comunicacion%' THEN
    SELECT string_agg(quote_literal(m[1]), ', ') INTO v_lista FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m WHERE m[1] <> 'marketing_comunicacion';
    ALTER TABLE public.mk_consulta DROP CONSTRAINT mk_consulta_agente_check;
    EXECUTE format('ALTER TABLE public.mk_consulta ADD CONSTRAINT mk_consulta_agente_check CHECK (agente IN (%s))', v_lista);
  END IF;
  -- mk_registrar_corrida y mk_latido_agente: se quita solo ese nombre de la lista
  FOREACH v_fn IN ARRAY ARRAY['public.mk_registrar_corrida(text,text,text,text,jsonb,timestamptz)', 'public.mk_latido_agente(text)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def LIKE '%marketing_comunicacion%' THEN
      v_nuevo := regexp_replace(v_def, ',\s*''marketing_comunicacion''', '');
      EXECUTE v_nuevo;
    END IF;
  END LOOP;
END;
$$;

-- Funciones de la pantalla
DROP FUNCTION IF EXISTS public.ic_crear_borrador(text, text, date, date, boolean);
DROP FUNCTION IF EXISTS public.ic_publicar(uuid);
DROP FUNCTION IF EXISTS public.ic_archivar(uuid);
DROP FUNCTION IF EXISTS public.ic_descartar_borrador(uuid);

-- Lectura: de vuelta las dos políticas originales
DROP POLICY IF EXISTS "Org users see published internal_comunicados" ON public.internal_comunicados;
DROP POLICY IF EXISTS "Org members can view internal comunicados" ON public.internal_comunicados;
CREATE POLICY "Org members can view internal comunicados" ON public.internal_comunicados FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Org users see internal_comunicados" ON public.internal_comunicados;
CREATE POLICY "Org users see internal_comunicados" ON public.internal_comunicados FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- Comunicados del agente y columnas nuevas
DELETE FROM public.internal_comunicados WHERE origen = 'agente';
DROP INDEX IF EXISTS public.idx_internal_comunicados_aviso;
ALTER TABLE public.internal_comunicados
  DROP CONSTRAINT IF EXISTS ic_estado_check, DROP CONSTRAINT IF EXISTS ic_origen_check, DROP CONSTRAINT IF EXISTS ic_vigencia_check,
  DROP CONSTRAINT IF EXISTS ic_avisar_requiere_vigencia, DROP CONSTRAINT IF EXISTS ic_agente_requiere_aprobacion, DROP CONSTRAINT IF EXISTS ic_agente_limites;
ALTER TABLE public.internal_comunicados
  DROP COLUMN IF EXISTS estado, DROP COLUMN IF EXISTS origen, DROP COLUMN IF EXISTS vigente_desde, DROP COLUMN IF EXISTS vigente_hasta,
  DROP COLUMN IF EXISTS avisar_al_entrar, DROP COLUMN IF EXISTS aprobado_por, DROP COLUMN IF EXISTS aprobado_at;
