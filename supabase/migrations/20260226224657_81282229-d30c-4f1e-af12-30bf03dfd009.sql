
-- Add lawsuit_details JSONB column to projects for tracking lawsuit-specific information
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS lawsuit_details jsonb DEFAULT NULL;

-- COMMENT: lawsuit_details structure:
-- {
--   "lawsuit_type": "laboral|mercantil|civil|fiscal|penal|administrativo",
--   "case_number": "EXP-123/2026",
--   "court": "Juzgado Segundo de lo Civil",
--   "plaintiff": "Actor name",
--   "defendant": "Demandado name",
--   "stages": [
--     { "key": "demanda", "label": "Demanda", "status": "pendiente", "date": null, "notes": "", "completed_at": null },
--     { "key": "contestacion", "label": "Contestación de demanda", ... },
--     { "key": "pruebas", "label": "Ofrecimiento y admisión de pruebas", ... },
--     { "key": "desahogo", "label": "Desahogo de pruebas", ... },
--     { "key": "alegatos", "label": "Alegatos", ... },
--     { "key": "sentencia", "label": "Sentencia", ... },
--     { "key": "apelacion", "label": "Apelación", ... },
--     { "key": "amparo", "label": "Amparo", ... },
--     { "key": "ejecucion", "label": "Ejecución de sentencia", ... }
--   ],
--   "deadlines": [
--     { "id": "uuid", "title": "Término para contestar", "date": "2026-03-15", "type": "termino|audiencia|entrega", "completed": false, "notes": "" }
--   ]
-- }
