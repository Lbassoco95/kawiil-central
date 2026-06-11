-- Elimina frases cacheadas que contienen artefactos del formato antiguo del prompt
-- (separadores ---, líneas "Conecta con:", prefijos "FRASE:", etc.).
-- Al borrarse, generate-phrase las regenerará con el nuevo prompt limpio en la
-- próxima visita del usuario al dashboard.
DELETE FROM public.personalized_phrases
WHERE phrase LIKE '%---%'
   OR phrase ILIKE '%Conecta con:%'
   OR phrase ILIKE '%Confianza:%'
   OR phrase ILIKE 'FRASE:%';
