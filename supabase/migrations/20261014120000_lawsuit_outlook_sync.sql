-- Sincronización de plazos/audiencias de juicios con Outlook.
-- Guarda el id del evento de cada fecha y de quién es el Outlook donde se creó
-- (microsoft-api opera sobre el buzón de quien llama, así que solo esa persona
-- puede actualizarlo o borrarlo).

ALTER TABLE public.project_lawsuits
  ADD COLUMN IF NOT EXISTS outlook_hearing_event_id text,
  ADD COLUMN IF NOT EXISTS outlook_deadline_event_id text,
  ADD COLUMN IF NOT EXISTS outlook_synced_by uuid;
