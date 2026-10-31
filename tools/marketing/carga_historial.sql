DO $load$
DECLARE
  v_org uuid := '__ORG__';
  r jsonb; v_pid uuid; v_prid uuid; v_f date; v_ts timestamptz;
  v_caso uuid;
  w date; red text; s record;
BEGIN
  PERFORM public.mk_sembrar_reglas_v1(v_org);

  FOR r IN SELECT jsonb_array_elements($j$[["H-20260731","2026-07-31","Pregunta de comunidad","Comunidad",null,null,null,36,5,2,1,37,0,0,0],["H-20260803","2026-08-03","Caso: restaurante","Caso",null,null,null,17,2,0,1,12,0,0,1],["H-20260805","2026-08-05","Ventas en efectivo y CFDI","Tip",null,null,null,22,4,1,0,12,1,1,1],["H-20260807","2026-08-07","3 contratos que necesitas","Legal",null,null,null,34,4,1,4,4,0,0,0],["H-20260810","2026-08-10","4 pilares del orden","Tip",null,null,null,26,2,1,0,2,0,0,0],["H-20260811","2026-08-11","Noticia: reglas antilavado","PLD",null,null,null,11,1,0,0,90,2,2,3],["H-20260812","2026-08-12","Hub: contador y abogado","Identidad",null,null,null,29,3,1,2,19,1,1,0],["H-20260813","2026-08-13","Enfoque basado en riesgo (reforma)","PLD",null,null,null,7,1,0,0,110,3,3,4],["H-20260814","2026-08-14","Reto: 4 pilares","Innovación",null,null,null,11,1,0,0,11,1,0,1],["H-20260817","2026-08-17","Cómo constituir tu empresa","Legal",null,null,null,8,0,0,0,2,0,0,0],["H-20260819","2026-08-19","Design Thinking: trabajar mejor","Innovación",null,null,null,27,3,1,0,6,0,1,0],["H-20260821","2026-08-21","Deducciones (tip)","Tip",null,null,null,9,0,0,0,3,0,0,0],["H-20260824","2026-08-24","KYC: expediente","PLD",null,null,null,37,7,1,0,1,0,0,0],["H-20260826","2026-08-26","Origen del nombre Kawiil","Identidad",null,null,null,83,13,3,4,78,4,1,3],["H-20260828","2026-08-28","Checklist de cierre de agosto","Contable",null,null,null,12,1,0,0,7,0,0,0],["H-20260828-2","2026-08-28","Día de los Abuelos","Fecha especial",null,null,null,null,null,null,null,33,0,0,0],["H-20260831","2026-08-31","Diagnóstico Kawiil","Venta",null,null,null,8,2,0,0,5,0,0,0],["H-20260908","2026-09-08","Actividades Vulnerables","PLD","Carrusel",80,1,12,2,0,0,7,0,0,0],["H-20260909","2026-09-09","Design Thinking","Innovación","Imagen única",87,4,13,2,0,0,2,0,0,0],["H-20260910","2026-09-10","RESICO","Contable","Carrusel",15,2,17,1,0,0,3,0,0,0],["H-20260912","2026-09-12","Bienvenida Comunidad","Comunidad","Carrusel",62,1,52,9,2,3,50,1,0,24],["H-20260915","2026-09-15","Expediente de identificación","PLD","Carrusel",65,2,8,0,0,0,55,0,0,1],["H-20260916","2026-09-16","16 de septiembre","Fecha especial","Imagen única",137,5,24,2,1,0,16,0,0,0],["H-20260917","2026-09-17","Contrato de servicios","Legal","Carrusel",18,2,26,3,1,1,19,0,0,0],["H-20260919","2026-09-19","Cuenta bancaria separada","Tip","Imagen única",14,0,28,4,1,0,35,1,1,0],["H-20260922","2026-09-22","Enfoque basado en riesgo","PLD",null,"E",null,11,2,0,0,0,0,0,0],["H-20260923","2026-09-23","Automatizar no es comprar software","Innovación",null,"E",null,12,1,0,0,25,0,0,1],["H-20260924","2026-09-24","Deducciones que se olvidan","Contable",null,"E",null,15,1,0,1,9,0,0,0],["H-20260926","2026-09-26","Frase: el orden no es burocracia","Frase",null,"E",null,33,3,1,0,7,0,0,0],["H-20260929","2026-09-29","Avisos PLD: el día 17","PLD",null,"E",null,6,1,0,0,3,0,0,0],["H-20260930","2026-09-30","Cierre de mes","Innovación","Carrusel",12,1,10,1,0,0,15,0,0,3],["H-20261001","2026-10-01","Persona física o moral","Legal","Carrusel",29,2,9,2,0,0,2,0,0,0],["H-20261003","2026-10-03","Pregunta de comunidad","Comunidad","Imagen única",12,0,11,1,0,0,2,0,0,0],["H-20261006","2026-10-06","Oficial de cumplimiento","PLD","Carrusel",14,1,27,6,1,1,5,0,0,0],["H-20261007","2026-10-07","El proceso de una persona","Innovación","Imagen única",55,3,9,2,0,0,21,0,0,0],["H-20261008","2026-10-08","Complemento de pago","Contable","Imagen única",15,1,20,2,0,0,0,0,0,0],["H-20261010","2026-10-10","Precio y costos fijos","Tip","Imagen única",19,1,10,2,0,0,14,0,0,0],["H-20261013","2026-10-13","Operaciones en efectivo","PLD","Carrusel",129,7,14,2,0,0,3,0,0,0],["H-20261014","2026-10-14","IA en tu negocio","Innovación","Carrusel",7,0,9,2,0,0,11,0,0,0],["H-20261015","2026-10-15","Socios sin convenio","Legal","Carrusel",15,1,26,5,1,0,2,0,0,0],["H-20261017","2026-10-17","Qué significa Kawiil","Identidad","Carrusel",79,7,21,6,1,0,2,0,0,0],["H-20261020","2026-10-20","Visita de verificación","PLD","Carrusel",11,0,10,2,0,0,2,0,0,0],["H-20261021","2026-10-21","Trabajar mejor, no más","Innovación","Imagen única",11,1,7,1,0,0,26,1,1,0],["H-20261022","2026-10-22","Cierre anual desde octubre","Contable","Carrusel",11,1,6,1,0,0,6,0,0,1],["H-20261024","2026-10-24","Frase: urgente e importante","Frase","Imagen única",8,0,3,1,0,0,61,1,0,1],["H-20261027","2026-10-27","Mitos de PLD","PLD","Carrusel",7,0,7,2,0,0,0,0,0,0],["H-20261028","2026-10-28","Reto 4 pilares","Innovación","Imagen única",9,1,7,1,0,0,0,0,0,0],["H-20261029","2026-10-29","NDA","Legal","Imagen única",8,1,11,1,0,0,0,0,0,0]]$j$::jsonb) LOOP
    v_f := (r->>1)::date;
    v_ts := (v_f::text || ' 11:00')::timestamp AT TIME ZONE 'America/Mexico_City';
    INSERT INTO public.mk_pieza (organization_id, codigo, titulo, pilar, formato, etapa, fecha, origen)
    VALUES (v_org, r->>0, r->>2, r->>3, NULLIF(r->>4, ''), 1, v_f, 'calendario_maestro')
    RETURNING id INTO v_pid;

    -- Instagram: valor numérico = publicada; 'E' = con errores (error «Unknown» según la pestaña Monitoreo)
    IF r->5 IS NOT NULL AND jsonb_typeof(r->5) = 'number' THEN
      INSERT INTO public.mk_pieza_red (organization_id, pieza_id, red, estado, publicada_at, hora_estimada)
      VALUES (v_org, v_pid, 'instagram', 'publicada', v_ts, true) RETURNING id INTO v_prid;
      INSERT INTO public.mk_resultado (organization_id, pieza_red_id, corte, fuente, medida, valor, extra, capturado_at)
      VALUES (v_org, v_prid, 'acumulado', 'calendario_maestro', 'alcance', (r->>5)::numeric,
              jsonb_build_object('interacciones', (r->>6)::int), '2026-10-31 12:00 America/Mexico_City');
    ELSIF r->>5 = 'E' THEN
      INSERT INTO public.mk_pieza_red (organization_id, pieza_id, red, estado, mensaje_error, hora_estimada)
      VALUES (v_org, v_pid, 'instagram', 'con_errores', 'Unknown', true);
    END IF;

    IF r->7 IS NOT NULL AND jsonb_typeof(r->7) = 'number' THEN
      INSERT INTO public.mk_pieza_red (organization_id, pieza_id, red, estado, publicada_at, hora_estimada)
      VALUES (v_org, v_pid, 'facebook', 'publicada', v_ts, true) RETURNING id INTO v_prid;
      INSERT INTO public.mk_resultado (organization_id, pieza_red_id, corte, fuente, medida, valor, reacciones, compartidos, clics, comentarios, capturado_at)
      VALUES (v_org, v_prid, 'acumulado', 'calendario_maestro', 'alcance', (r->>7)::numeric,
              (r->>8)::int, (r->>9)::int, (r->>10)::int, 0, '2026-10-31 12:00 America/Mexico_City');
    END IF;

    IF r->11 IS NOT NULL AND jsonb_typeof(r->11) = 'number' THEN
      INSERT INTO public.mk_pieza_red (organization_id, pieza_id, red, estado, publicada_at, hora_estimada)
      VALUES (v_org, v_pid, 'linkedin', 'publicada', v_ts, true) RETURNING id INTO v_prid;
      INSERT INTO public.mk_resultado (organization_id, pieza_red_id, corte, fuente, medida, valor, reacciones, compartidos, clics, comentarios, capturado_at)
      VALUES (v_org, v_prid, 'acumulado', 'calendario_maestro', 'impresiones', (r->>11)::numeric,
              (r->>12)::int, (r->>13)::int, (r->>14)::int, 0, '2026-10-31 12:00 America/Mexico_City');
    END IF;
  END LOOP;

  -- Seguidores: una sola lectura (consulta del 31 oct 2026), puesta en la semana del 26 oct
  INSERT INTO public.mk_seguidores_semana (organization_id, red, semana_inicio, seguidores, fuente) VALUES
    (v_org, 'instagram', '2026-10-26', 154, 'calendario_maestro'),
    (v_org, 'facebook',  '2026-10-26', 1111, 'calendario_maestro'),
    (v_org, 'linkedin',  '2026-10-26', 1295, 'calendario_maestro');

  -- Caso 1 (septiembre)
  INSERT INTO public.mk_caso (organization_id, tipo, red, titulo, descripcion, evidencia, estado, responsable, detectado_at)
  VALUES (v_org, 'investigacion', 'instagram',
    'Septiembre 2026: 5 piezas fallidas en Instagram, 11 días sin posts y caída de alcance desde el 17 de septiembre',
    'Caso cargado desde el Calendario Maestro (pestañas Monitoreo, Datos Metricool, Datos FB y LinkedIn y Datos y decisiones; consulta de Metricool del 31 oct 2026). La caída de alcance empezó antes de las fallas; la causa no está determinada. El Revisor lo recorre en la Entrega 4 sin ejecutar correcciones.',
    $e$[
{"tipo":"hecho","dato":"Las 5 piezas del 22, 23, 24, 26 y 29 de septiembre figuran «Con errores» en Instagram, mensaje «Unknown»; en Facebook y LinkedIn sí se publicaron.","fuente":"Calendario Maestro · Monitoreo, sección 1; Datos Metricool, nota"},
{"tipo":"hecho","dato":"Instagram estuvo 11 días sin posts en el feed (del 19 al 30 de septiembre) y no se detectó a tiempo.","fuente":"Calendario Maestro · Monitoreo, sección 1 y 4"},
{"tipo":"hecho","dato":"Alcance en Instagram: 137 el 16 sep, 18 el 17 sep, 14 el 19 sep; casi todo octubre entre 7 y 29 (con picos de 129 el 13 oct y 79 el 17 oct).","fuente":"Calendario Maestro · Datos Metricool"},
{"tipo":"hecho","dato":"Semana del 21 sep sin datos de Instagram: las piezas fallaron. Promedio semanal de IG: 61 (7 sep), 58.5 (14 sep), sin datos (21 sep), 17.67 (28 sep), 25.75 (5 oct), 57.5 (12 oct), 10.25 (19 oct), 8 (26 oct).","fuente":"Calendario Maestro · Datos y decisiones, sección 2"},
{"tipo":"hecho","dato":"El mensaje de error es solo «Unknown»: no se sabe si fue la conexión, Instagram o las piezas.","fuente":"Calendario Maestro · Monitoreo, sección 1"},
{"tipo":"hecho","dato":"La caída del 17 y 19 de septiembre ocurrió antes de las fallas, por lo que la falla técnica no la explica por completo.","fuente":"Calendario Maestro · Monitoreo, sección 1"},
{"tipo":"hecho","dato":"Todas las piezas salieron cerca de las 11:00 (una sola hora); Instagram tiene 154 seguidores.","fuente":"Calendario Maestro · Datos FB y LinkedIn, nota; Datos y decisiones"},
{"tipo":"hipotesis","estado":"Confirmada, parcial","dato":"1. Falla técnica: la pieza no se publicó. Confirmada para 5 piezas de IG.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"Por probar","dato":"2. Hueco de 11 días en Instagram (19 → 30 sep). Plausible, no probada.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"Probable","dato":"3. El 16 de septiembre fue un pico por la fecha, no el nivel normal (mediana 15).","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"En prueba","dato":"4. Tema: Contable ≈14, Legal ≈18, Frase 8, frente a PLD ≈51.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"Por probar","dato":"5. Copy: 9-10 hashtags y link kawiil.mx en cada pieza. Sin dato todavía.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"Por probar","dato":"6. Diseño: carruseles con mucho texto y fondo oscuro.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"En prueba","dato":"7. Horario: todo a las 11:00; sin datos de otros horarios.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"Contexto","dato":"8. Cuenta chica: 154 seguidores en Instagram.","fuente":"Calendario Maestro · Monitoreo, sección 4"},
{"tipo":"hipotesis","estado":"Pendiente","dato":"9. Estado de la cuenta de Instagram (restricción). No se ha revisado.","fuente":"Calendario Maestro · Monitoreo, sección 4"}
]$e$::jsonb,
    'abierto', 'revisor', '2026-10-31 12:00 America/Mexico_City')
  RETURNING id INTO v_caso;

  -- Calibración del semáforo: fórmula vs cifras del archivo (solo Instagram trae cifra semanal)
  FOR w IN SELECT generate_series('2026-07-27'::date, '2026-10-26'::date, interval '7 days')::date LOOP
    FOREACH red IN ARRAY ARRAY['instagram', 'facebook', 'linkedin'] LOOP
      SELECT * INTO s FROM public.mk_semaforo_semana(v_org, w, red, 'calendario_maestro');
      INSERT INTO public.mk_calibracion
        (organization_id, semana_inicio, red, piezas_calculadas, promedio_calculado, piezas_calendario, promedio_calendario,
         color_calculado, color_calendario, diferencia, nota)
      SELECT v_org, w, red, s.piezas, s.promedio,
             c.piezas, c.promedio, s.color, NULL,
             CASE WHEN c.piezas IS NOT NULL THEN s.promedio - c.promedio END,
             CASE
               WHEN red <> 'instagram' THEN 'El archivo no trae cifra semanal de esta red; solo promedio general.'
               WHEN c.piezas IS NULL THEN 'El archivo no trae cifra para esta semana (solo cubre 7 sep en adelante).'
               ELSE NULL END
      FROM (SELECT 1) x
      LEFT JOIN (SELECT (e->>1)::int AS piezas, (e->>2)::numeric AS promedio
                 FROM jsonb_array_elements($s$[["2026-09-07",4,61],["2026-09-14",4,58.5],["2026-09-21",0,null],["2026-09-28",3,17.6666666666667],["2026-10-05",4,25.75],["2026-10-12",4,57.5],["2026-10-19",4,10.25],["2026-10-26",3,8]]$s$::jsonb) e WHERE (e->>0)::date = w AND red = 'instagram') c ON true;
    END LOOP;
  END LOOP;

  INSERT INTO public.mk_bitacora (organization_id, agente, accion, resultado, detalle, caso_id)
  VALUES (v_org, 'sistema', 'carga_historial_calendario_maestro',
          '48 piezas; 26+5 publicaciones IG, 47 FB, 48 LI; 121 resultados; caso 1; calibración',
          jsonb_build_object('fuente', 'Calendario_Maestro_Kawiil_Nov2026_Ene2027.xlsx', 'metricool_api', 'pendiente'), v_caso);
END
$load$;
