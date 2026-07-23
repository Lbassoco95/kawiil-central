-- =============================================================
-- Módulo Conmutador (Switchboard) — Telefonía + secretario IA
-- C3.0: datos base del Conmutador.
--
-- Objetos:
--   * switchboard_call    — una fila por llamada atendida (folio, célula,
--                           urgencia, datos del llamante, ruta, G4 destino,
--                           transferencia, enlaces a transcript/grabación).
--   * folio_sequence      — contador atómico por año para folios KAW-AAAA-XXXX.
--   * switchboard_config  — configuración por célula (preguntas, prompt, voz)
--                           y el enlace/override al G4 de RH.
--   * v_g4_por_celula     — VISTA que LEE el G4 vigente desde el catálogo de
--                           RH (public.celulas + public.profiles). NO duplica
--                           el catálogo de células/colaboradores.
--
-- Convenciones reutilizadas del repo:
--   public.get_user_org_id(uuid), public.has_role(uuid, app_role),
--   public.update_updated_at_column(). RLS activa en todas las tablas.
-- =============================================================

-- -------------------------------------------------------------
-- 1. folio_sequence — contador consecutivo atómico por año
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folio_sequence (
  anio        integer PRIMARY KEY,
  consecutivo integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.folio_sequence IS
  'Contador consecutivo por año para folios del Conmutador (KAW-AAAA-XXXX). El incremento atómico lo hace la Edge Function sw-folio con UPDATE ... RETURNING.';

-- -------------------------------------------------------------
-- 2. switchboard_config — configuración por célula
--    celula: código del Conmutador (LIT|CORP|COMP|CONT|PROC).
--    celula_slug: enlaza con public.celulas(slug) del módulo RH para
--                 resolver el G4 vigente sin duplicar el catálogo.
--    g4_override_user_id: override manual del destino (opcional).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.switchboard_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  celula              text NOT NULL CHECK (celula IN ('LIT','CORP','COMP','CONT','PROC')),
  celula_slug         text,          -- FK lógica a public.celulas(slug) (mismo org)
  g4_override_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  preguntas           jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_override     text,
  voz                 text,          -- voice_id de ElevenLabs
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, celula)
);

CREATE INDEX IF NOT EXISTS idx_switchboard_config_org
  ON public.switchboard_config(organization_id);

COMMENT ON TABLE public.switchboard_config IS
  'Configuración del Conmutador por célula: preguntas mínimas de la entrevista (ruta estándar), override del prompt, voz de ElevenLabs y enlace/override al G4 de RH.';
COMMENT ON COLUMN public.switchboard_config.celula_slug IS
  'slug de public.celulas (módulo RH) al que mapea esta célula del Conmutador. Editable desde la UI; usado por v_g4_por_celula para leer el G4 vigente.';
COMMENT ON COLUMN public.switchboard_config.g4_override_user_id IS
  'Override manual del G4 destino de transferencia. Si es NULL, se usa celulas.responsible_user_id del celula_slug.';

-- -------------------------------------------------------------
-- 3. switchboard_call — registro de cada llamada
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.switchboard_call (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folio           text UNIQUE,
  celula          text CHECK (celula IN ('LIT','CORP','COMP','CONT','PROC')),
  urgencia        text NOT NULL DEFAULT 'standard'
                    CHECK (urgencia IN ('urgent','medium','standard')),
  llamante        text,
  empresa         text,
  es_cliente      boolean,
  telefono        text,
  correo          text,
  motivo          text,
  ruta            text CHECK (ruta IN ('urgente','estandar')),
  g4_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  transferido     boolean NOT NULL DEFAULT false,
  -- Enlace opcional al cliente de Finanzas (integración CONT + pago/cobranza)
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  cartera_estado  text,          -- 'al_dia' | 'vencido' | null
  brief           text,
  conversation_id text,          -- id de la conversación en ElevenLabs
  transcript_url  text,
  recording_url   text,
  agent_task_id   uuid,          -- tarea de seguimiento creada en agent_tasks
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_switchboard_call_org_created
  ON public.switchboard_call(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_switchboard_call_celula
  ON public.switchboard_call(organization_id, celula);
CREATE INDEX IF NOT EXISTS idx_switchboard_call_urgencia
  ON public.switchboard_call(organization_id, urgencia);
CREATE INDEX IF NOT EXISTS idx_switchboard_call_g4
  ON public.switchboard_call(g4_id);

COMMENT ON TABLE public.switchboard_call IS
  'Una fila por llamada atendida por el secretario IA del Conmutador. La escriben las Edge Functions (service_role); la UI solo lee.';
COMMENT ON COLUMN public.switchboard_call.g4_id IS
  'Colaborador G4 de RH al que se canalizó/transfirió la llamada (auth.users.id).';

-- -------------------------------------------------------------
-- 4. Triggers updated_at
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_switchboard_config ON public.switchboard_config;
CREATE TRIGGER set_updated_at_switchboard_config
  BEFORE UPDATE ON public.switchboard_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_switchboard_call ON public.switchboard_call;
CREATE TRIGGER set_updated_at_switchboard_call
  BEFORE UPDATE ON public.switchboard_call
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- 5. Vista v_g4_por_celula — LEE el G4 vigente desde RH.
--    No duplica el catálogo: resuelve por celula_slug → public.celulas
--    → responsible_user_id → public.profiles (nombre + teléfono).
--    El override de switchboard_config tiene prioridad.
--    security_invoker=true: respeta la RLS del usuario que consulta.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_g4_por_celula
WITH (security_invoker = true) AS
SELECT
  sc.organization_id,
  sc.celula,
  sc.celula_slug,
  COALESCE(sc.g4_override_user_id, c.responsible_user_id) AS g4_id,
  p.full_name  AS g4_nombre,
  p.phone      AS g4_telefono,
  p.email      AS g4_email,
  CASE WHEN sc.g4_override_user_id IS NOT NULL THEN 'override' ELSE 'rh' END AS source
FROM public.switchboard_config sc
LEFT JOIN public.celulas c
  ON c.slug = sc.celula_slug
 AND c.organization_id = sc.organization_id
LEFT JOIN public.profiles p
  ON p.user_id = COALESCE(sc.g4_override_user_id, c.responsible_user_id);

COMMENT ON VIEW public.v_g4_por_celula IS
  'G4 vigente por célula del Conmutador. Lee el responsable desde el catálogo de RH (public.celulas.responsible_user_id) vía celula_slug, con override opcional desde switchboard_config. security_invoker=true.';

-- =============================================================
-- 6. RLS
-- =============================================================
ALTER TABLE public.folio_sequence     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.switchboard_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.switchboard_call   ENABLE ROW LEVEL SECURITY;

-- folio_sequence: sin políticas para authenticated (solo service_role, que
-- omite RLS). Nadie del cliente lee/escribe el contador directamente.

-- switchboard_config: la org lee; solo G4 (transformador) administra.
DROP POLICY IF EXISTS "Org reads switchboard_config" ON public.switchboard_config;
CREATE POLICY "Org reads switchboard_config" ON public.switchboard_config
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "G4 manages switchboard_config" ON public.switchboard_config;
CREATE POLICY "G4 manages switchboard_config" ON public.switchboard_config
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  );

-- switchboard_call: lo escriben las Edge Functions (service_role). La UI solo
-- lee: los G4 ven toda la org; un G4 también ve las llamadas canalizadas a él.
DROP POLICY IF EXISTS "G4 reads org switchboard_call" ON public.switchboard_call;
CREATE POLICY "G4 reads org switchboard_call" ON public.switchboard_call
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (public.has_role(auth.uid(), 'transformador') OR g4_id = auth.uid())
  );

-- =============================================================
-- 7. Seed switchboard_config para la organización Kawiil.
--    Mapeo célula (Conmutador) → slug (RH). Editable desde la UI.
--      LIT  → juicios        (litigio/audiencias/amparos)
--      CORP → legal          (sociedades/contratos/fusiones)
--      COMP → pld_ft         (PLD-FT/KYC/regulación/auditorías)
--      CONT → contabilidad   (SAT/IMSS/declaraciones/nómina)
--      PROC → softlanding    (procesos internos — placeholder ajustable)
-- =============================================================
INSERT INTO public.switchboard_config (organization_id, celula, celula_slug, preguntas) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'LIT', 'juicios', '[
    "¿Hay una audiencia o fecha límite próxima? ¿Cuándo?",
    "¿Hay una persona detenida o bajo custodia?",
    "¿Existe un documento de autoridad (citatorio, oficio, notificación)?",
    "¿Ante qué juzgado o instancia se lleva el asunto?",
    "¿Cuentan con número de expediente?"
  ]'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'CORP', 'legal', '[
    "¿Se trata de constitución, modificación de sociedad o de un contrato?",
    "¿Cuántas partes intervienen?",
    "¿Hay una fecha límite de firma?",
    "¿Quién es la contraparte y en qué etapa va la negociación?"
  ]'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'COMP', 'pld_ft', '[
    "¿Recibieron una notificación de autoridad regulatoria?",
    "¿Hay una fecha límite de respuesta?",
    "¿El tema es de PLD-FT, protección de datos o auditoría?",
    "¿Es un asunto preventivo o ya en curso?"
  ]'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'CONT', 'contabilidad', '[
    "¿El tema es con SAT, IMSS o INFONAVIT?",
    "¿Recibieron carta invitación, crédito fiscal o requerimiento?",
    "¿De qué período fiscal se trata?",
    "¿Necesitan una declaración, aclaración o representación?"
  ]'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'PROC', 'softlanding', '[
    "¿Se busca digitalizar un proceso existente o diseñar uno nuevo?",
    "¿Qué personas o áreas están involucradas?",
    "¿Hay una fecha o proyecto asociado?",
    "¿El proceso está documentado actualmente?"
  ]'::jsonb)
ON CONFLICT (organization_id, celula) DO NOTHING;
