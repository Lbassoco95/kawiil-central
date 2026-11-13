-- ¿La cuenta de Google ya dio permiso de lectura de Drive? Se deduce del scope que guardó el callback; el navegador no puede leer `scope`
-- (protege los tokens), así que se expone solo este booleano. Es una columna generada: no hay que mantenerla a mano.
ALTER TABLE public.linked_accounts
  ADD COLUMN IF NOT EXISTS drive_enabled boolean GENERATED ALWAYS AS (provider = 'google' AND coalesce(scope, '') LIKE '%auth/drive%') STORED;

GRANT SELECT (drive_enabled) ON public.linked_accounts TO authenticated;
