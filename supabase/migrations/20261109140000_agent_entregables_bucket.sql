-- Bucket PRIVADO para los documentos (Word, Excel, PDF) que entregan los agentes.
--
-- Quién escribe: la VM `kawiil-agents` con la llave de servicio, bajo `<task_id>/<NN>-<nombre>.<ext>`.
-- Quién lee: nadie directamente. No hay ninguna policy para `authenticated` ni `anon`, así que ningún usuario puede listar, leer o escribir
-- en este bucket por la API de Storage. Dirección descarga con enlaces firmados de 5 minutos que genera la función `agente-seguimiento`
-- (solo admin/manager) a partir de la ruta registrada en la tarea.
--
-- Los documentos pueden traer datos de clientes: por eso NO se reutiliza `documents` (sus policies no limitan por ruta ni por organización).
-- Tope de 10 MB por archivo y solo los tres tipos que genera el servidor.
--
-- Rollback: delete from storage.buckets where id = 'agent-entregables';   (antes, vaciar el bucket)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agent-entregables', 'agent-entregables', false, 10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
