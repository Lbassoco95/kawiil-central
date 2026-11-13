-- Marketing: el Vigía deja una tarea completada por día cuando todo está bien. APLICADA en producción el 13 nov 2026 (10:02 CDMX) con confirmación de Dirección.
-- Requiere antes 20261104165612_marketing_vigia_registra.sql y 20261104165545_marketing_registrar_corrida.sql (ya aplicadas).
-- Misma decisión de «corrió / no corrió», mismos casos y bitácora; cambia SOLO la rama «todo bien» (antes: solo latido; ahora: una tarea completada del día).
-- Una corrida repetida el mismo día no duplica la tarea. Si registrar falla, queda una fila en la bitácora y el vigía sigue.
-- Reversa: tools/marketing/rollback_vigia_tarea_diaria.sql (vuelve a la definición de 20261104165612).

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
  v_fallo_registro text;
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
    -- Todo bien: el Vigía deja UNA tarea completada por día en el registro de agentes (actualiza también su latido y sus contadores), sin bitácora ni caso.
    -- Antes solo dejaba latido, y el servicio kawiil-agents lo sobrescribe (marca a todos los agentes igual), así que la pantalla lo veía «sin datos».
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.agent_tasks t JOIN public.agent_registry a ON a.id = t.agent_id
        WHERE a.name = 'marketing_vigia' AND t.status = 'completed' AND t.title = 'Vigía ' || v_hoy
      ) THEN
        PERFORM public.mk_registrar_corrida('marketing_vigia', 'completed', 'Vigía ' || v_hoy,
                                            'Sin novedad: el Vigilante dejó registro de la corrida del ' || v_hoy,
                                            jsonb_build_object('fecha', v_hoy, 'corrida_vigilante', true));
      ELSE
        PERFORM public.mk_latido_agente('marketing_vigia'); -- ya hay tarea de hoy (corrida repetida): solo latido
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle)
      VALUES (v_org, 'sistema', 'vigia_colchon', 'no se pudo registrar la corrida del vigía: ' || left(SQLERRM, 200), jsonb_build_object('fecha', v_hoy));
    END;
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
    PERFORM public.mk_vigia_registra_falla(v_org, v_hoy, v_motivo, v_caso.numero);
    RETURN 'SIN CORRIDA: caso #' || v_caso.numero || ' abierto';
  END IF;

  UPDATE public.mk_caso
  SET descripcion = v_desc, evidencia = jsonb_build_object('fecha', v_hoy, 'simulada', false, 'fallas', jsonb_build_array(v_motivo))
  WHERE id = v_caso.id;
  PERFORM public.mk_vigia_registra_falla(v_org, v_hoy, v_motivo, v_caso.numero);
  RETURN 'SIN CORRIDA: caso #' || v_caso.numero || ' ya estaba abierto (actualizado)';
END;
$$;


REVOKE ALL ON FUNCTION public.mk_vigia_colchon(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_vigia_colchon(timestamptz) TO service_role;
