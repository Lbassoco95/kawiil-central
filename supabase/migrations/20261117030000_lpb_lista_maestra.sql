-- Lista maestra de Personas Bloqueadas (LPB) de transmisores de dinero.
-- La mantiene el servicio de agentes (service_role) aplicando SOLO cambios (altas y bajas) con su historial; Kawiil Central la muestra a Dirección
-- por la función `agente-lpb`. Las tablas de agentes viven en otra organización que los usuarios: por eso NO hay políticas para `authenticated`
-- (RLS activo y sin políticas = solo service_role).

CREATE TABLE IF NOT EXISTS public.lpb_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 300),
  nombre_norm text NOT NULL CHECK (char_length(nombre_norm) BETWEEN 2 AND 300),          -- mayúsculas, sin acentos ni puntuación: para comparar
  rfc text CHECK (rfc IS NULL OR rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  rfc_dudoso boolean NOT NULL DEFAULT false,                                              -- no pasa fecha o dígito verificador (puede ser el dato del propio oficio)
  tipo_persona text NOT NULL DEFAULT 'desconocida' CHECK (tipo_persona IN ('fisica', 'moral', 'desconocida')),
  estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'eliminada', 'eliminacion_provisional')),
  fecha_alta date,
  fecha_baja date,
  datos_incompletos boolean NOT NULL DEFAULT false,                                       -- falta RFC o tipo: se completa al releer el oficio
  origen text NOT NULL DEFAULT 'agente' CHECK (origen IN ('importado_marzo_2026', 'agente', 'manual')),
  revisado boolean NOT NULL DEFAULT false,                                                -- una persona lo verificó contra el PDF
  notas text CHECK (notas IS NULL OR char_length(notas) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Una persona con RFC es una sola fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lpb_personas_rfc ON public.lpb_personas (organization_id, rfc) WHERE rfc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lpb_personas_nombre ON public.lpb_personas (organization_id, nombre_norm);
CREATE INDEX IF NOT EXISTS idx_lpb_personas_estado ON public.lpb_personas (organization_id, estado);

CREATE TABLE IF NOT EXISTS public.lpb_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  persona_id uuid NOT NULL REFERENCES public.lpb_personas (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('bloqueo', 'adicion', 'confirmacion', 'bloqueo_grupal', 'eliminacion', 'eliminacion_provisional', 'reversion', 'modificacion', 'desconocido')),
  oficio text CHECK (oficio IS NULL OR char_length(oficio) <= 80),
  fecha_oficio date,
  acuerdo text CHECK (acuerdo IS NULL OR char_length(acuerdo) <= 80),
  fundamento text CHECK (fundamento IS NULL OR char_length(fundamento) <= 1000),
  archivo text CHECK (archivo IS NULL OR char_length(archivo) <= 200),                    -- nombre del oficio guardado en Dropbox
  aviso_id text CHECK (aviso_id IS NULL OR char_length(aviso_id) <= 40),                  -- id del aviso en el SITI
  fuente text NOT NULL DEFAULT 'siti' CHECK (fuente IN ('siti', 'importado_marzo_2026', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- El mismo movimiento (persona + tipo + oficio) no se registra dos veces aunque se vuelva a procesar el aviso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lpb_movimientos ON public.lpb_movimientos (persona_id, tipo, oficio) WHERE oficio IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lpb_movimientos_persona ON public.lpb_movimientos (persona_id, fecha_oficio DESC);
CREATE INDEX IF NOT EXISTS idx_lpb_movimientos_fecha ON public.lpb_movimientos (organization_id, fecha_oficio DESC);

-- Registro de avisos del SITI ya revisados: sirve para saber «desde cuándo» y para la doble revisión.
CREATE TABLE IF NOT EXISTS public.lpb_avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  aviso_id text NOT NULL CHECK (char_length(aviso_id) <= 40),
  fecha date,
  titulo text CHECK (titulo IS NULL OR char_length(titulo) <= 200),
  categoria text NOT NULL DEFAULT 'lpb' CHECK (categoria IN ('lpb', 'gafi', 'otro')),
  n_oficios integer CHECK (n_oficios IS NULL OR n_oficios BETWEEN 0 AND 500),
  oficios jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(oficios) = 'array' AND octet_length(oficios::text) <= 20000),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'descargado', 'registrado', 'revisar')),
  procesado_en timestamptz,
  notas text CHECK (notas IS NULL OR char_length(notas) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, aviso_id)
);
CREATE INDEX IF NOT EXISTS idx_lpb_avisos_fecha ON public.lpb_avisos (organization_id, fecha DESC);

CREATE OR REPLACE FUNCTION public.lpb_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_lpb_personas_touch ON public.lpb_personas;
CREATE TRIGGER trg_lpb_personas_touch BEFORE UPDATE ON public.lpb_personas FOR EACH ROW EXECUTE FUNCTION public.lpb_touch();
DROP TRIGGER IF EXISTS trg_lpb_avisos_touch ON public.lpb_avisos;
CREATE TRIGGER trg_lpb_avisos_touch BEFORE UPDATE ON public.lpb_avisos FOR EACH ROW EXECUTE FUNCTION public.lpb_touch();

ALTER TABLE public.lpb_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lpb_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lpb_avisos ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo service_role (el servicio de agentes y la función agente-lpb).
