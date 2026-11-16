-- Corrección de 20261116221334_marketing_comunicacion_interna.sql (APLICADA en producción el 16 nov 2026, versión 20261116223934).
-- Aquella migración comprobaba «¿la definición ya contiene marketing_comunicacion?» con una búsqueda de texto, y el nombre del agente de OTRA sesión
-- (marketing_comunicacion_interna) contiene esa cadena: se saltó el alta de `marketing_comunicacion` en las listas de agentes.
-- Esta migración agrega `marketing_comunicacion` a mk_registrar_corrida y mk_latido_agente comprobando el nombre EXACTO (entre comillas). No toca a ningún otro agente
-- (se conserva marketing_comunicacion_interna y los demás) ni los permisos. Idempotente.
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_nuevo text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.mk_registrar_corrida(text,text,text,text,jsonb,timestamptz)', 'public.mk_latido_agente(text)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def LIKE '%''marketing_comunicacion''%' THEN CONTINUE; END IF;
    v_nuevo := regexp_replace(v_def, '(\mname IN \([^)]*)\)', '\1, ''marketing_comunicacion'')');
    IF v_nuevo = v_def THEN RAISE EXCEPTION 'no se encontró la lista de agentes en %', v_fn; END IF;
    EXECUTE v_nuevo;
  END LOOP;
END;
$$;

-- mk_consulta.agente: misma comprobación exacta (ya incluye al agente; esto solo lo asegura si faltara).
DO $$
DECLARE
  v_def text;
  v_lista text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.mk_consulta'::regclass AND conname = 'mk_consulta_agente_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe mk_consulta_agente_check'; END IF;
  IF v_def LIKE '%''marketing_comunicacion''%' THEN RETURN; END IF;
  SELECT string_agg(quote_literal(m[1]), ', ') INTO v_lista FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  ALTER TABLE public.mk_consulta DROP CONSTRAINT mk_consulta_agente_check;
  EXECUTE format('ALTER TABLE public.mk_consulta ADD CONSTRAINT mk_consulta_agente_check CHECK (agente IN (%s, %L))', v_lista, 'marketing_comunicacion');
END;
$$;
