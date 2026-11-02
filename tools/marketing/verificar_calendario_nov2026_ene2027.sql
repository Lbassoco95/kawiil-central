-- Verificación posterior (solo lectura): recuento por semana (lunes a domingo, hora de Ciudad de México) y por red.
SELECT date_trunc('week', p.programada_at AT TIME ZONE 'America/Mexico_City')::date AS semana,
       count(DISTINCT p.id) AS piezas,
       count(*) FILTER (WHERE r.red = 'instagram') AS instagram,
       count(*) FILTER (WHERE r.red = 'facebook')  AS facebook,
       count(*) FILTER (WHERE r.red = 'linkedin')  AS linkedin
FROM public.mk_pieza p JOIN public.mk_pieza_red r ON r.pieza_id = p.id
WHERE p.fecha >= DATE '2026-11-01' GROUP BY 1 ORDER BY 1;
SELECT pilar, count(*) FROM public.mk_pieza WHERE fecha >= DATE '2026-11-01' GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) AS piezas_anteriores_intactas FROM public.mk_pieza WHERE fecha <= DATE '2026-10-31';  -- debe seguir en 48
