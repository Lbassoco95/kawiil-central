-- Estatus propios para trámites legales (quejas Profeco/Condusef, etc.).
ALTER TABLE public.project_lawsuits DROP CONSTRAINT IF EXISTS project_lawsuits_status_check;
ALTER TABLE public.project_lawsuits ADD CONSTRAINT project_lawsuits_status_check
  CHECK (status IN (
    'en_tramite', 'en_apelacion', 'amparo', 'suspendido', 'concluido', 'archivado',
    'en_espera_respuesta', 'en_conciliacion', 'convenio'
  ));
