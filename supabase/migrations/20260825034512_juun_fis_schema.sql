-- =================================================================
-- Ju'un — Bloque 1: esquema de autofacturación de tickets de gasto
--
-- Ju'un convierte la foto de un ticket de gasto en el CFDI de ese gasto.
-- NO emite CFDI propios, NO timbra, NO usa PAC y NO toca la e.firma ni la
-- CIEC del cliente: solo usa sus datos fiscales públicos (RFC, razón social,
-- CP fiscal, régimen, uso CFDI) para llenar el formulario del portal del
-- comercio donde se hizo la compra.
--
-- Tenancy: el tenant de este repo es la ORGANIZACIÓN, no el cliente. Por eso
-- cada tabla con datos lleva `organization_id NOT NULL` (columna de RLS) y
-- `client_id` (relación de negocio). Mismo patrón que client_sat_certificates
-- y moffin_cfdi_counts.
--
-- Nombres: inglés, con `fis_` como namespace. Los términos fiscales mexicanos
-- se quedan en español a propósito (rfc, razon_social, regimen_fiscal,
-- uso_cfdi, cp_fiscal, csf_*, folio): traducirlos sería peor.
--
-- Rollback de acompañamiento: migrations/2026-08-24_juun_fis_schema.rollback.sql
-- =================================================================

-- ── 1. Perfiles fiscales del cliente ────────────────────────────────
-- 1:N — un cliente puede facturar a nombre de varias empresas. Uno de los
-- perfiles es el predeterminado (is_default) y es el que usa el agente si el
-- usuario no elige otro.
CREATE TABLE IF NOT EXISTS public.fis_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Datos que deben coincidir EXACTAMENTE con la CSF vigente.
  rfc text NOT NULL
    CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  razon_social text NOT NULL CHECK (btrim(razon_social) <> ''),
  cp_fiscal text NOT NULL CHECK (cp_fiscal ~ '^[0-9]{5}$'),
  regimen_fiscal text NOT NULL
    CHECK (regimen_fiscal IN (
      '601','603','605','606','607','608','610','611','612','614','615','616',
      '620','621','622','623','624','625','626'
    )),
  uso_cfdi_default text NOT NULL DEFAULT 'G03'
    CHECK (uso_cfdi_default IN (
      'G01','G02','G03',
      'I01','I02','I03','I04','I05','I06','I07','I08',
      'D01','D02','D03','D04','D05','D06','D07','D08','D09','D10',
      'S01','CP01','CN01'
    )),
  email_recepcion text,

  -- Constancia de Situación Fiscal: objeto en el bucket privado `juun`.
  csf_file_path text,
  csf_verified_at timestamptz,
  csf_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, rfc)
);

COMMENT ON TABLE public.fis_tax_profiles IS
  'Datos fiscales del cliente para llenar portales de facturación de terceros. NO contiene e.firma ni CIEC: solo datos públicos de la CSF.';
COMMENT ON COLUMN public.fis_tax_profiles.rfc IS
  'RFC del receptor. 12 caracteres persona moral (3 letras), 13 persona física (4 letras), con homoclave.';
COMMENT ON COLUMN public.fis_tax_profiles.razon_social IS
  'Razón social EXACTA como aparece en la CSF vigente. Una abreviatura de diferencia hace que el comercio rechace la factura.';
COMMENT ON COLUMN public.fis_tax_profiles.cp_fiscal IS
  'Código postal FISCAL (el de la CSF), no el comercial ni el de la sucursal.';
COMMENT ON COLUMN public.fis_tax_profiles.csf_file_path IS
  'Ruta del PDF de la CSF en el bucket privado `juun` (tipo `csf`). Se lee solo por signed URL de corta vida.';
COMMENT ON COLUMN public.fis_tax_profiles.csf_verified_at IS
  'Sello de verificación manual del perfil contra la CSF. Se marca a mano; csf_verified_by guarda quién.';

-- Un solo perfil predeterminado por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fis_tax_profiles_default
  ON public.fis_tax_profiles (client_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_fis_tax_profiles_org_client
  ON public.fis_tax_profiles (organization_id, client_id);

CREATE INDEX IF NOT EXISTS idx_fis_tax_profiles_client_active
  ON public.fis_tax_profiles (client_id)
  WHERE active;

DROP TRIGGER IF EXISTS update_fis_tax_profiles_updated_at ON public.fis_tax_profiles;
CREATE TRIGGER update_fis_tax_profiles_updated_at
  BEFORE UPDATE ON public.fis_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Mantiene coherente el "predeterminado" sin depender de que el front haga
-- dos escrituras en el orden correcto:
--   · marcar uno como default desmarca a los demás del mismo cliente;
--   · dar de baja un perfil le quita el default;
--   · el primer perfil activo de un cliente queda default automáticamente.
CREATE OR REPLACE FUNCTION public.fis_tax_profiles_sync_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NOT NEW.active THEN
    NEW.is_default := false;
  ELSIF NOT NEW.is_default THEN
    -- Si no hay otro perfil activo para este cliente, éste es el default.
    IF NOT EXISTS (
      SELECT 1 FROM public.fis_tax_profiles
      WHERE client_id = NEW.client_id
        AND active
        AND id <> NEW.id
    ) THEN
      NEW.is_default := true;
    END IF;
  END IF;

  IF NEW.is_default THEN
    UPDATE public.fis_tax_profiles
       SET is_default = false
     WHERE client_id = NEW.client_id
       AND id <> NEW.id
       AND is_default;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fis_tax_profiles_sync_default() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fis_tax_profiles_sync_default ON public.fis_tax_profiles;
CREATE TRIGGER trg_fis_tax_profiles_sync_default
  BEFORE INSERT OR UPDATE OF is_default, active ON public.fis_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fis_tax_profiles_sync_default();

-- Y al revés: si el cliente se queda sin predeterminado (le dieron de baja al
-- que lo era, o lo borraron) pero todavía tiene perfiles activos, el más
-- antiguo toma el lugar. Un cliente con perfiles activos siempre tiene uno
-- predeterminado, para que el agente nunca tenga que adivinar a nombre de
-- quién factura.
CREATE OR REPLACE FUNCTION public.fis_tax_profiles_ensure_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_client uuid;
BEGIN
  v_client := COALESCE(NEW.client_id, OLD.client_id);

  IF EXISTS (
    SELECT 1 FROM public.fis_tax_profiles
    WHERE client_id = v_client AND active AND is_default
  ) THEN
    RETURN NULL;  -- ya hay predeterminado: nada que hacer (y corta la recursión)
  END IF;

  UPDATE public.fis_tax_profiles
     SET is_default = true
   WHERE id = (
     SELECT id FROM public.fis_tax_profiles
      WHERE client_id = v_client AND active
      ORDER BY created_at, id
      LIMIT 1
   );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fis_tax_profiles_ensure_default() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fis_tax_profiles_ensure_default ON public.fis_tax_profiles;
CREATE TRIGGER trg_fis_tax_profiles_ensure_default
  AFTER UPDATE OF is_default, active OR DELETE ON public.fis_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fis_tax_profiles_ensure_default();

-- ── 2. Catálogo de comercios (global) ───────────────────────────────
-- Agregar un portal es DATO, no código: la receta de navegación vive en
-- `recipe` como JSON y un intérprete genérico la ejecuta (Bloque 3).
CREATE TABLE IF NOT EXISTS public.fis_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  rfc_emisor text,
  portal_url text,
  required_fields jsonb NOT NULL DEFAULT '{}'::jsonb,

  window_type text NOT NULL
    CHECK (window_type IN ('days', 'end_of_month', 'not_applicable')),
  window_days int
    CHECK (window_days IS NULL OR window_days > 0),

  recipe jsonb,
  recipe_version int NOT NULL DEFAULT 0,
  self_heal_enabled boolean NOT NULL DEFAULT true,
  dom_fingerprint text,

  method text NOT NULL DEFAULT 'manual'
    CHECK (method IN ('agent', 'manual', 'unsupported')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- window_type='days' exige N días; los otros dos tipos no lo usan.
  CONSTRAINT fis_merchants_window_days_coherent CHECK (
    (window_type = 'days' AND window_days IS NOT NULL)
    OR (window_type <> 'days' AND window_days IS NULL)
  )
);

COMMENT ON TABLE public.fis_merchants IS
  'Catálogo global de comercios y su receta de portal. Lectura para cualquier autenticado; escritura solo service_role.';
COMMENT ON COLUMN public.fis_merchants.aliases IS
  'Variantes del nombre tal como se imprimen en los tickets (WAL-MART, BODEGA AURRERA...). De esto depende el match automático del comercio.';
COMMENT ON COLUMN public.fis_merchants.required_fields IS
  'Campos que el portal exige, como {"folio":"num","total":"money"}. Tipos: text | num | money | date | url.';
COMMENT ON COLUMN public.fis_merchants.window_type IS
  'Plazo para facturar: days = fecha del ticket + window_days; end_of_month = último día del mes de la compra; not_applicable = el comercio no factura tickets.';
COMMENT ON COLUMN public.fis_merchants.recipe IS
  'Copia ACTIVA de la receta declarativa del portal. El histórico y las propuestas viven en fis_recipe_versions.';
COMMENT ON COLUMN public.fis_merchants.self_heal_enabled IS
  'Kill switch de autorreparación para este comercio. En false, un selector roto manda el ticket a manual_queue sin consultar al modelo.';
COMMENT ON COLUMN public.fis_merchants.method IS
  'Motor a usar: agent (receta probada), manual (a mano, con los datos listos), unsupported (el ticket no es comprobante fiscal).';

CREATE INDEX IF NOT EXISTS idx_fis_merchants_active
  ON public.fis_merchants (active, method);

CREATE INDEX IF NOT EXISTS idx_fis_merchants_aliases
  ON public.fis_merchants USING gin (aliases);

DROP TRIGGER IF EXISTS update_fis_merchants_updated_at ON public.fis_merchants;
CREATE TRIGGER update_fis_merchants_updated_at
  BEFORE UPDATE ON public.fis_merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3. Versiones de receta ──────────────────────────────────────────
-- Una receta propuesta por el modelo NO se promueve sola: nace 'proposed' y
-- solo pasa a 'active' si el reintento del ticket que la generó tuvo éxito.
CREATE TABLE IF NOT EXISTS public.fis_recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.fis_merchants(id) ON DELETE CASCADE,
  version int NOT NULL,
  recipe jsonb NOT NULL,
  status text NOT NULL
    CHECK (status IN ('proposed', 'active', 'retired')),
  proposed_by text NOT NULL
    CHECK (proposed_by IN ('model', 'human')),
  proposal_reason text,
  diff_summary jsonb,
  promoted_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (merchant_id, version)
);

COMMENT ON TABLE public.fis_recipe_versions IS
  'Histórico y propuestas de receta por comercio. Una receta reparada por el modelo nace proposed y solo se promueve a active si el reintento tuvo éxito.';
COMMENT ON COLUMN public.fis_recipe_versions.diff_summary IS
  'Qué cambió respecto a la versión anterior. Si el modelo propone cambiar más de 2 pasos, no se aplica: eso es un portal rediseñado, no un selector movido.';

-- Una sola receta activa por comercio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fis_recipe_versions_active
  ON public.fis_recipe_versions (merchant_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_fis_recipe_versions_merchant
  ON public.fis_recipe_versions (merchant_id, version DESC);

-- ── 4. El ticket cargado ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fis_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tax_profile_id uuid REFERENCES public.fis_tax_profiles(id) ON DELETE SET NULL,
  merchant_id uuid REFERENCES public.fis_merchants(id) ON DELETE SET NULL,
  -- No fusionamos Ju'un con el módulo de gastos internos (expenses), pero
  -- dejar el enlace cuesta una columna y permite colgar el CFDI de un gasto
  -- que ya está en flujo de reembolso.
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,

  file_path text NOT NULL,
  file_hash text NOT NULL,

  extraction jsonb,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  receipt_date date,
  receipt_time time,
  total numeric(12,2),
  currency text NOT NULL DEFAULT 'MXN',
  payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('cash', 'card', 'transfer', 'unknown')),
  category text
    CHECK (category IS NULL OR category IN (
      'fuel', 'restaurant', 'groceries', 'hardware', 'transport', 'lodging', 'other'
    )),

  deductible boolean,
  non_deductible_reason text,

  expires_at timestamptz,

  status text NOT NULL DEFAULT 'received'
    CHECK (status IN (
      -- camino feliz
      'received', 'extracted', 'validated', 'queued', 'processing', 'invoiced',
      -- salidas laterales
      'needs_data', 'unknown_merchant', 'window_expired', 'not_deductible',
      'duplicate', 'portal_rejected', 'manual_queue'
    )),

  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  lease_until timestamptz,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Anti-duplicado por binario: la misma foto no se procesa dos veces.
  UNIQUE (client_id, file_hash)
);

COMMENT ON TABLE public.fis_receipts IS
  'Ticket de gasto cargado, su extracción y el estado de su facturación.';
COMMENT ON COLUMN public.fis_receipts.file_hash IS
  'sha256 del binario del archivo. Anti-duplicado: unique (client_id, file_hash).';
COMMENT ON COLUMN public.fis_receipts.extraction IS
  'Salida CRUDA y completa del extractor (QR y/o visión), sin recortar, más qué modelo y versión de prompt se usó.';
COMMENT ON COLUMN public.fis_receipts.expires_at IS
  'Fin de la ventana de facturación del comercio. La cola se ordena por esta columna, no por FIFO.';
COMMENT ON COLUMN public.fis_receipts.lease_until IS
  'Reserva del job por el worker. Si el worker muere, al vencer el lease el ticket vuelve a estar tomable.';
COMMENT ON COLUMN public.fis_receipts.status IS
  'Máquina de estados (13). Feliz: received → extracted → validated → queued → processing → invoiced. Laterales: needs_data, unknown_merchant, window_expired, not_deductible, duplicate, portal_rejected, manual_queue.';

-- Anti-duplicado por folio: el mismo ticket fotografiado dos veces (distinto
-- binario, mismo folio y monto en el mismo comercio) no se factura dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fis_receipts_merchant_folio
  ON public.fis_receipts (client_id, merchant_id, (extraction->>'folio'), total)
  WHERE merchant_id IS NOT NULL AND extraction->>'folio' IS NOT NULL;

-- La cola: pendientes ordenados por vencimiento.
CREATE INDEX IF NOT EXISTS idx_fis_receipts_queue
  ON public.fis_receipts (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_fis_receipts_org_client
  ON public.fis_receipts (organization_id, client_id);

CREATE INDEX IF NOT EXISTS idx_fis_receipts_expense
  ON public.fis_receipts (expense_id)
  WHERE expense_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_fis_receipts_updated_at ON public.fis_receipts;
CREATE TRIGGER update_fis_receipts_updated_at
  BEFORE UPDATE ON public.fis_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Intentos de facturación (auditoría) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.fis_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.fis_receipts(id) ON DELETE CASCADE,

  adapter text NOT NULL
    CHECK (adapter IN ('agent', 'mock', 'manual')),
  recipe_version int,
  started_at timestamptz,
  finished_at timestamptz,
  result text NOT NULL
    CHECK (result IN (
      'success', 'failure', 'captcha_failed', 'portal_down',
      'data_rejected', 'window_expired'
    )),
  error_code text,
  error_detail text,
  screenshot_path text,
  trace_path text,
  cost_mxn numeric(10,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fis_attempts IS
  'Cada intento de facturar un ticket. Es la auditoría del módulo, no un log suelto: sin screenshot ni trace no se puede depurar un portal que cambió ni demostrar qué se hizo con los datos del cliente.';

CREATE INDEX IF NOT EXISTS idx_fis_attempts_receipt
  ON public.fis_attempts (receipt_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fis_attempts_org
  ON public.fis_attempts (organization_id);

-- ── 6. El resultado: el CFDI ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fis_cfdi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.fis_receipts(id) ON DELETE CASCADE,

  uuid_fiscal text NOT NULL UNIQUE,
  xml_path text NOT NULL,
  pdf_path text,
  total numeric(12,2),
  issue_date timestamptz,
  rfc_emisor text,
  rfc_receptor text,
  sat_status text NOT NULL DEFAULT 'unverified'
    CHECK (sat_status IN ('valid', 'cancelled', 'not_found', 'unverified')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fis_cfdi IS
  'CFDI obtenido para un ticket. El XML es el documento fiscal; el PDF es la representación impresa y puede faltar.';
COMMENT ON COLUMN public.fis_cfdi.uuid_fiscal IS
  'UUID del Timbre Fiscal Digital. Unique global: el mismo CFDI no se registra dos veces.';
COMMENT ON COLUMN public.fis_cfdi.rfc_receptor IS
  'RFC receptor leído DEL XML. Debe coincidir con el del perfil fiscal; si no, el ticket va a manual_queue y no se marca invoiced.';

CREATE INDEX IF NOT EXISTS idx_fis_cfdi_receipt
  ON public.fis_cfdi (receipt_id);

CREATE INDEX IF NOT EXISTS idx_fis_cfdi_org
  ON public.fis_cfdi (organization_id);

-- ── 7. organization_id derivado del ticket ──────────────────────────
-- fis_attempts y fis_cfdi cuelgan de un ticket, y su organization_id es el
-- del ticket. Derivarlo aquí, en lugar de confiar en lo que manda el worker,
-- hace imposible que una fila quede con el org de otro tenant y se escape de
-- la RLS.
CREATE OR REPLACE FUNCTION public.fis_inherit_receipt_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.fis_receipts
   WHERE id = NEW.receipt_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fis: receipt % no existe', NEW.receipt_id;
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fis_inherit_receipt_org() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_fis_attempts_inherit_org ON public.fis_attempts;
CREATE TRIGGER trg_fis_attempts_inherit_org
  BEFORE INSERT OR UPDATE OF receipt_id ON public.fis_attempts
  FOR EACH ROW EXECUTE FUNCTION public.fis_inherit_receipt_org();

DROP TRIGGER IF EXISTS trg_fis_cfdi_inherit_org ON public.fis_cfdi;
CREATE TRIGGER trg_fis_cfdi_inherit_org
  BEFORE INSERT OR UPDATE OF receipt_id ON public.fis_cfdi
  FOR EACH ROW EXECUTE FUNCTION public.fis_inherit_receipt_org();

-- ── 8. RLS ──────────────────────────────────────────────────────────
-- Tablas con datos de cliente: aisladas por organización, con el mismo helper
-- que usa el resto del repo. DELETE restringido a admin/manager porque estas
-- filas son la auditoría de qué se hizo con los datos fiscales de un cliente.
--
-- Catálogo (fis_merchants, fis_recipe_versions): lectura para cualquier
-- autenticado, escritura solo service_role (que bypassa RLS): las recetas las
-- escribe el worker, nunca el navegador.

ALTER TABLE public.fis_tax_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fis_tax_profiles_select" ON public.fis_tax_profiles;
CREATE POLICY "fis_tax_profiles_select"
  ON public.fis_tax_profiles FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_tax_profiles_insert" ON public.fis_tax_profiles;
CREATE POLICY "fis_tax_profiles_insert"
  ON public.fis_tax_profiles FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_tax_profiles_update" ON public.fis_tax_profiles;
CREATE POLICY "fis_tax_profiles_update"
  ON public.fis_tax_profiles FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_tax_profiles_delete" ON public.fis_tax_profiles;
CREATE POLICY "fis_tax_profiles_delete"
  ON public.fis_tax_profiles FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

ALTER TABLE public.fis_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fis_receipts_select" ON public.fis_receipts;
CREATE POLICY "fis_receipts_select"
  ON public.fis_receipts FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_receipts_insert" ON public.fis_receipts;
CREATE POLICY "fis_receipts_insert"
  ON public.fis_receipts FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_receipts_update" ON public.fis_receipts;
CREATE POLICY "fis_receipts_update"
  ON public.fis_receipts FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_receipts_delete" ON public.fis_receipts;
CREATE POLICY "fis_receipts_delete"
  ON public.fis_receipts FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

ALTER TABLE public.fis_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fis_attempts_select" ON public.fis_attempts;
CREATE POLICY "fis_attempts_select"
  ON public.fis_attempts FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_attempts_insert" ON public.fis_attempts;
CREATE POLICY "fis_attempts_insert"
  ON public.fis_attempts FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_attempts_update" ON public.fis_attempts;
CREATE POLICY "fis_attempts_update"
  ON public.fis_attempts FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_attempts_delete" ON public.fis_attempts;
CREATE POLICY "fis_attempts_delete"
  ON public.fis_attempts FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

ALTER TABLE public.fis_cfdi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fis_cfdi_select" ON public.fis_cfdi;
CREATE POLICY "fis_cfdi_select"
  ON public.fis_cfdi FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_cfdi_insert" ON public.fis_cfdi;
CREATE POLICY "fis_cfdi_insert"
  ON public.fis_cfdi FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_cfdi_update" ON public.fis_cfdi;
CREATE POLICY "fis_cfdi_update"
  ON public.fis_cfdi FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "fis_cfdi_delete" ON public.fis_cfdi;
CREATE POLICY "fis_cfdi_delete"
  ON public.fis_cfdi FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.is_admin_or_manager(auth.uid())
  );

-- Catálogo global: solo lectura desde el navegador.
ALTER TABLE public.fis_merchants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fis_merchants_select" ON public.fis_merchants;
CREATE POLICY "fis_merchants_select"
  ON public.fis_merchants FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.fis_recipe_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fis_recipe_versions_select" ON public.fis_recipe_versions;
CREATE POLICY "fis_recipe_versions_select"
  ON public.fis_recipe_versions FOR SELECT TO authenticated
  USING (true);
