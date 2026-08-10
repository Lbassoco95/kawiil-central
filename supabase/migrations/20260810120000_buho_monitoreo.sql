-- Integración Búho Legal — Monitoreo de expedientes.
-- Vincula un juicio (projects.area='juicios') con un expediente registrado en la
-- API de Búho Legal (https://monitoreo.buholegal.com/api/v1/) y almacena los
-- "acuerdos" (actuaciones del juzgado) que la API va publicando.
--
--   buho_auth         → cache del token JWT del despacho (una fila por organización).
--   buho_expedientes  → mapeo juicio ↔ expediente Búho (uno por proyecto).
--   buho_acuerdos     → acuerdos sincronizados desde Búho (feed del expediente).
--
-- RLS: colaborativa por organización (mismo criterio que el resto de tablas).
-- Aditivo: no toca ninguna tabla existente ni otros módulos.

-- ─── Cache de token del despacho ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buho_auth (
  organization_id uuid PRIMARY KEY,
  access text,
  refresh text,
  access_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.buho_auth ENABLE ROW LEVEL SECURITY;
-- Solo el service_role (edge functions) lee/escribe el token; nunca el cliente.
GRANT ALL ON public.buho_auth TO service_role;

-- ─── Mapeo juicio ↔ expediente Búho ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buho_expedientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  buho_id integer,
  entidad text NOT NULL,
  expediente text NOT NULL,
  juzgado_id integer,
  tipo_expediente text,
  nombre text,
  last_synced_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buho_expedientes_project_unique UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_buho_expedientes_org ON public.buho_expedientes (organization_id);

ALTER TABLE public.buho_expedientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buho_exp_select_org" ON public.buho_expedientes;
CREATE POLICY "buho_exp_select_org"
  ON public.buho_expedientes FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "buho_exp_insert_org" ON public.buho_expedientes;
CREATE POLICY "buho_exp_insert_org"
  ON public.buho_expedientes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "buho_exp_update_org" ON public.buho_expedientes;
CREATE POLICY "buho_exp_update_org"
  ON public.buho_expedientes FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "buho_exp_delete_org" ON public.buho_expedientes;
CREATE POLICY "buho_exp_delete_org"
  ON public.buho_expedientes FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buho_expedientes TO authenticated;
GRANT ALL ON public.buho_expedientes TO service_role;

DROP TRIGGER IF EXISTS set_buho_expedientes_updated_at ON public.buho_expedientes;
CREATE TRIGGER set_buho_expedientes_updated_at
  BEFORE UPDATE ON public.buho_expedientes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Acuerdos sincronizados ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buho_acuerdos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  buho_expediente_id uuid NOT NULL REFERENCES public.buho_expedientes(id) ON DELETE CASCADE,
  expediente text,
  fuente text,
  fecha_acuerdo date,
  tipo_acuerdo text,
  contenido text,
  juzgado text,
  raw jsonb,
  seen boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buho_acuerdos_project ON public.buho_acuerdos (project_id);
CREATE INDEX IF NOT EXISTS idx_buho_acuerdos_org ON public.buho_acuerdos (organization_id);
-- Dedup: un acuerdo por expediente + fecha + hash de contenido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_buho_acuerdos_dedup
  ON public.buho_acuerdos (buho_expediente_id, fecha_acuerdo, md5(coalesce(contenido, '')));

ALTER TABLE public.buho_acuerdos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buho_acu_select_org" ON public.buho_acuerdos;
CREATE POLICY "buho_acu_select_org"
  ON public.buho_acuerdos FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- Marcar como leído (update) permitido a la organización; inserción la hace el
-- service_role desde la edge function de sincronización.
DROP POLICY IF EXISTS "buho_acu_update_org" ON public.buho_acuerdos;
CREATE POLICY "buho_acu_update_org"
  ON public.buho_acuerdos FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, UPDATE ON public.buho_acuerdos TO authenticated;
GRANT ALL ON public.buho_acuerdos TO service_role;
