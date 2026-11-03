-- Carga del Calendario Maestro de noviembre de 2026 a enero de 2027 (46 piezas × 3 redes = 138 filas).
-- NO SE EJECUTA sin confirmación explícita de Dirección (escritura 6). Se corre UNA vez, desde execute_sql.
--
-- Qué hace
--   * Inserta 46 filas en mk_pieza (origen calendario_maestro) con código C-AAAAMMDD, y 3 filas por pieza en mk_pieza_red
--     (instagram, facebook, linkedin) en estado 'pendiente', con programada_at = fecha y hora de Ciudad de México.
--   * No guarda estado_archivo: esa columna está desactualizada. Lo programado se lee de Metricool.
--   * No toca las 48 piezas existentes (H-AAAAMMDD, hasta el 29 de octubre): ni UPDATE ni DELETE.
-- No duplica
--   * Los códigos nuevos (C-...) no chocan con los viejos (H-...), y UNIQUE (organization_id, codigo) + ON CONFLICT DO NOTHING
--     hace la carga idempotente.
--   * Aborta si ya hay piezas del 1 de noviembre de 2026 en adelante, y revierte todo si el recuento final no es 46 / 138.
DO $$
DECLARE
  org uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  IF EXISTS (SELECT 1 FROM public.mk_pieza WHERE organization_id = org AND fecha >= DATE '2026-11-01') THEN
    RAISE EXCEPTION 'Ya hay piezas desde el 1 de noviembre de 2026: no se carga para no duplicar';
  END IF;

  WITH datos(num, fecha, hora, pilar, formato, tema) AS (VALUES
    (1, '2026-11-02', '12:00', 'Fecha especial', 'Imagen única', 'Recordar también es cuidar'),
    (2, '2026-11-03', '13:00', 'PLD', 'Carrusel 5', 'Las reglas antilavado entran en vigor el 30 de noviembre'),
    (3, '2026-11-04', '11:00', 'Innovación', 'Carrusel 4', 'Un solo hub vs. tres proveedores'),
    (4, '2026-11-05', '20:00', 'Contable', 'Carrusel 6', 'Contabilidad para entender (1/4): ¿para qué sirve llevarla?'),
    (5, '2026-11-07', '11:00', 'Comunidad', 'Carrusel 5', 'Los 4 pendientes que no deben llegar a diciembre'),
    (6, '2026-11-10', '17:30', 'PLD', 'Imagen única', 'Los avisos del mes: la fecha es el 17'),
    (7, '2026-11-11', '20:00', 'Innovación', 'Carrusel 4', 'Qué automatizar antes del cierre: 3 tareas'),
    (8, '2026-11-12', '08:30', 'Legal', 'Carrusel 4', 'Buen Fin: lo que anuncias te obliga'),
    (9, '2026-11-14', '17:30', 'Frase', 'Imagen única', 'Frase: el orden es tranquilidad'),
    (10, '2026-11-17', '20:00', 'PLD', 'Carrusel 5', 'Tu matriz de riesgo en 3 pasos'),
    (11, '2026-11-18', '08:30', 'Innovación', 'Imagen única', '5 procesos que debes documentar antes de diciembre'),
    (12, '2026-11-19', '13:00', 'Contable', 'Carrusel 6', 'Contabilidad para entender (2/4): cómo se registra, del comprobante al reporte'),
    (13, '2026-11-20', '09:00', 'Fecha especial', 'Imagen única', '20 de noviembre: lo que se conquista, se cuida'),
    (14, '2026-11-21', '20:00', 'Tip Kawiil', 'Imagen única', 'Tu presupuesto 2027 en una hoja'),
    (15, '2026-11-24', '08:30', 'PLD', 'Imagen única', 'Faltan 6 días: lo que debes tener listo'),
    (16, '2026-11-25', '13:00', 'Innovación', 'Carrusel 4', 'IA en el cierre: 3 tareas donde sí ayuda'),
    (17, '2026-11-26', '17:30', 'Legal', 'Carrusel 4', 'Contratos que se renuevan solos: revisa antes de que pase'),
    (18, '2026-11-28', '08:30', 'Comunidad', 'Imagen única', 'Lo que dejaste para diciembre'),
    (19, '2026-12-01', '13:00', 'PLD', 'Carrusel 4', 'Ya entró en vigor: lo que sigue'),
    (20, '2026-12-02', '17:30', 'Innovación', 'Imagen única', 'Calendario de cierre de diciembre'),
    (21, '2026-12-03', '20:00', 'Contable', 'Carrusel 5', 'Aguinaldo: cómo se calcula, con un ejemplo'),
    (22, '2026-12-05', '13:00', 'Tip Kawiil', 'Imagen única', 'Qué guardar y por cuánto tiempo'),
    (23, '2026-12-08', '17:30', 'PLD', 'Imagen única', 'La capacitación anual de PLD arranca el 1 de enero'),
    (24, '2026-12-09', '20:00', 'Innovación', 'Carrusel 4', 'Prueba de una semana sin ti'),
    (25, '2026-12-10', '08:30', 'Legal', 'Carrusel 4', 'Asamblea y libros corporativos al día'),
    (26, '2026-12-12', '09:00', 'Fecha especial', 'Imagen única', 'Con constancia y con cariño'),
    (27, '2026-12-15', '20:00', 'PLD', 'Imagen única', 'Cierra el año sin avisos pendientes'),
    (28, '2026-12-16', '08:30', 'Innovación', 'Imagen única', 'Qué sí y qué no automatizar en 2027'),
    (29, '2026-12-17', '13:00', 'Contable', 'Carrusel 6', 'Contabilidad para entender (3/4): ganar no es lo mismo que tener dinero'),
    (30, '2026-12-19', '20:00', 'Frase', 'Imagen única', 'Frase: cuidar el detalle es respeto'),
    (31, '2026-12-22', '08:30', 'PLD', 'Imagen única', 'Mitos de la reforma antilavado'),
    (32, '2026-12-23', '13:00', 'Innovación', 'Imagen única', 'Tus 4 propósitos de orden para 2027'),
    (33, '2026-12-24', '18:00', 'Fecha especial', 'Imagen única', 'Gracias por dejarnos cuidar lo que construyes'),
    (34, '2026-12-26', '08:30', 'Comunidad', 'Imagen única', 'Lo que valoramos de este año'),
    (35, '2026-12-29', '13:00', 'PLD', 'Imagen única', 'Checklist PLD de cierre de año'),
    (36, '2026-12-30', '17:30', 'Innovación', 'Imagen única', 'Tu balance del año en 3 preguntas'),
    (37, '2026-12-31', '19:00', 'Fecha especial', 'Imagen única', 'Cerramos el año cuidando lo que importa'),
    (38, '2027-01-01', '10:00', 'Fecha especial', 'Imagen única', 'Feliz 2027: empezamos con orden'),
    (39, '2027-01-02', '13:00', 'Kawiil', 'Carrusel 4', 'Por qué hacemos lo que hacemos'),
    (40, '2027-01-05', '17:30', 'PLD', 'Carrusel 4', 'Primer mes con reglas nuevas: qué sigue'),
    (41, '2027-01-06', '09:00', 'Fecha especial', 'Imagen única', 'Que tu rosca tenga muchos Reyes'),
    (42, '2027-01-07', '08:30', 'Legal', 'Carrusel 4', 'Contratos que vencen en enero: revisa vigencias hoy'),
    (43, '2027-01-09', '17:30', 'Comunidad', 'Imagen única', 'Tu meta de orden 2027'),
    (44, '2027-01-12', '20:00', 'PLD', 'Imagen única', 'Capacitación PLD: cómo documentarla'),
    (45, '2027-01-13', '08:30', 'Innovación', 'Imagen única', 'Documentar un proceso en 30 minutos'),
    (46, '2027-01-14', '13:00', 'Contable', 'Carrusel 7', 'Contabilidad para entender (4/4): qué debe enseñarte y entregarte tu contador')
  ),
  nuevas AS (
    INSERT INTO public.mk_pieza (organization_id, codigo, titulo, pilar, formato, etapa, programada_at, fecha, origen)
    SELECT org, 'C-' || to_char(d.fecha::date, 'YYYYMMDD'), d.tema, d.pilar, d.formato, 1,
           (d.fecha || ' ' || d.hora)::timestamp AT TIME ZONE 'America/Mexico_City', d.fecha::date, 'calendario_maestro'
    FROM datos d
    ON CONFLICT (organization_id, codigo) DO NOTHING
    RETURNING id, programada_at
  )
  INSERT INTO public.mk_pieza_red (organization_id, pieza_id, red, estado, programada_at, hora_estimada)
  SELECT org, n.id, r.red, 'pendiente', n.programada_at, false
  FROM nuevas n CROSS JOIN (VALUES ('instagram'), ('facebook'), ('linkedin')) AS r(red);

  IF (SELECT count(*) FROM public.mk_pieza WHERE organization_id = org AND fecha >= DATE '2026-11-01') <> 46
     OR (SELECT count(*) FROM public.mk_pieza_red r JOIN public.mk_pieza p ON p.id = r.pieza_id
         WHERE p.organization_id = org AND p.fecha >= DATE '2026-11-01') <> 138 THEN
    RAISE EXCEPTION 'Recuento inesperado tras la carga; se revierte todo';
  END IF;
END $$;
