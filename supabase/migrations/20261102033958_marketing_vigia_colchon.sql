-- Vigía del colchón (Marketing). Detecta el caso "el trabajo no corrió": si a las 7:30 de Ciudad de México no hay registro
-- de la corrida real del Vigilante del día (ni exitosa ni fallida), deja una fila en la bitácora y abre/actualiza el único
-- caso falla_monitoreo del colchón. Si hay registro, no escribe nada. Lo cierra la siguiente corrida buena de marketing-colchon.
-- No habla con Metricool, no envía correo, Slack ni WhatsApp. Solo escribe en mk_bitacora y mk_caso.
CREATE OR REPLACE FUNCTION public.mk_vigia_colchon(p_ahora timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoy date := (p_ahora AT TIME ZONE 'America/Mexico_City')::date;
  v_org uuid;
  v_n integer;
  v_caso record;
  v_motivo text;
  v_desc text;
BEGIN
  SELECT count(*) INTO v_n FROM public.organizations;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'mk_vigia_colchon: organización ambigua (% organizaciones)', v_n;
  END IF;
  SELECT id INTO v_org FROM public.organizations;

  -- ¿Corrió el Vigilante del colchón hoy? Cuenta cualquier corrida real (buena o fallida); las simuladas no cuentan.
  IF EXISTS (
    SELECT 1 FROM public.mk_bitacora
    WHERE organization_id = v_org AND agente = 'vigilante' AND accion = 'colchon'
      AND (registrado_at AT TIME ZONE 'America/Mexico_City')::date = v_hoy
      AND COALESCE(detalle->>'simulada', 'false') <> 'true'
  ) THEN
    RETURN 'ok: hay registro de la corrida del ' || v_hoy;
  END IF;

  v_motivo := 'sin registro de la corrida del colchón del ' || v_hoy || ' a las 7:30 (el trabajo no corrió o murió antes de registrarse)';
  v_desc := 'El Vigilante del colchón no pudo completar la corrida del ' || v_hoy || ': ' || v_motivo
            || '. Mientras siga abierto, el colchón y el informe pueden estar desactualizados.';

  INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle)
  VALUES (v_org, 'sistema', 'vigia_colchon', 'SIN CORRIDA del colchón del ' || v_hoy, jsonb_build_object('fecha', v_hoy));

  SELECT id, numero INTO v_caso FROM public.mk_caso
  WHERE organization_id = v_org AND tipo = 'falla_monitoreo' AND regla_codigo = 'colchon' AND red IS NULL AND estado <> 'cerrado'
  ORDER BY numero LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.mk_caso (organization_id, tipo, regla_codigo, red, titulo, descripcion, evidencia, responsable)
    VALUES (v_org, 'falla_monitoreo', 'colchon', NULL, 'Falla de monitoreo del colchón', v_desc,
            jsonb_build_object('fecha', v_hoy, 'simulada', false, 'fallas', jsonb_build_array(v_motivo)), 'vigilante')
    RETURNING id, numero INTO v_caso;
    INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle, caso_id)
    VALUES (v_org, 'sistema', 'vigia_colchon', 'caso #' || v_caso.numero || ' de falla de monitoreo abierto por el vigía: ' || v_motivo,
            jsonb_build_object('fecha', v_hoy), v_caso.id);
    RETURN 'SIN CORRIDA: caso #' || v_caso.numero || ' abierto';
  END IF;

  UPDATE public.mk_caso
  SET descripcion = v_desc, evidencia = jsonb_build_object('fecha', v_hoy, 'simulada', false, 'fallas', jsonb_build_array(v_motivo))
  WHERE id = v_caso.id;
  RETURN 'SIN CORRIDA: caso #' || v_caso.numero || ' ya estaba abierto (actualizado)';
END;
$$;

-- Solo la ejecuta el trabajo programado (rol dueño) o service_role; nadie desde la aplicación.
REVOKE ALL ON FUNCTION public.mk_vigia_colchon(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_vigia_colchon(timestamptz) TO service_role;
