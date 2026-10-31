-- Marketing: quitar a anon todo privilegio sobre las tablas mk_* (RLS ya no le daba filas; ahora tampoco el privilegio).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mk_pieza','mk_pieza_red','mk_resultado','mk_seguidores_semana','mk_regla','mk_regla_historial',
    'mk_caso','mk_propuesta','mk_decision','mk_experimento','mk_bitacora','mk_calibracion','mk_cobertura_fuente'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;
