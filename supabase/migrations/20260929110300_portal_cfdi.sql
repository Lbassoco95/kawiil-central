-- =================================================================
-- Portal del cliente — M4/M6: facturas (emitidas y recibidas),
-- categorización, tablero, expediente de emisión, CSD, emisión y
-- solicitudes de cancelación.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_cfdi.rollback.sql
--
-- CSD: el .cer/.key cifrados viven en `client_sat_certificates` (tabla
-- existente, cert_type = 'csd_sello', mismo cifrado AES-GCM). Esta migración
-- NO la altera. La contraseña de la llave va a `portal_csd_secrets`, cifrada
-- con PORTAL_CSD_SECRET por la Edge portal-api. Ni `anon` ni `authenticated`
-- tienen privilegio alguno sobre esas dos tablas: el cifrado nunca sale por
-- PostgREST, y ninguna función de aquí lo devuelve.
-- =================================================================

-- ── Catálogo de categorías (editable por organización) ──────────────
CREATE TABLE IF NOT EXISTS public.portal_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  -- kind alimenta las marcas de no deducibilidad.
  kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general', 'combustible', 'restaurante')),
  clave_prod_serv text CHECK (clave_prod_serv IS NULL OR clave_prod_serv ~ '^[0-9]{8}$'),
  cuenta_contable text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
ALTER TABLE public.portal_expense_categories ENABLE ROW LEVEL SECURITY;

-- Semilla mínima en la organización Kawiil (si existe). Claves SAT y cuentas
-- quedan vacías a propósito: las captura el equipo contable.
INSERT INTO public.portal_expense_categories (organization_id, name, kind)
SELECT o.id, v.name, v.kind
  FROM public.organizations o
 CROSS JOIN (VALUES
   ('Combustible', 'combustible'), ('Restaurantes y consumo', 'restaurante'),
   ('Arrendamiento', 'general'), ('Servicios profesionales', 'general'),
   ('Telefonía e internet', 'general'), ('Papelería y oficina', 'general'),
   ('Transporte y viáticos', 'general'), ('Mercancía y materia prima', 'general'),
   ('Otros gastos', 'general')) AS v(name, kind)
 WHERE o.id = 'a0000000-0000-0000-0000-000000000001'
ON CONFLICT (organization_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.portal_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.portal_expense_categories(id) ON DELETE CASCADE,
  match_rfc_emisor text,
  match_clave_prefix text CHECK (match_clave_prefix IS NULL OR match_clave_prefix ~ '^[0-9]{2,8}$'),
  match_text text,
  priority int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_category_rules_has_matcher CHECK (
    match_rfc_emisor IS NOT NULL OR match_clave_prefix IS NOT NULL OR match_text IS NOT NULL)
);
ALTER TABLE public.portal_category_rules ENABLE ROW LEVEL SECURITY;

-- ── Facturas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_cfdi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  uuid text NOT NULL CHECK (uuid ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  direction text NOT NULL CHECK (direction IN ('emitida', 'recibida')),
  source text NOT NULL CHECK (source IN ('moffin', 'carga_xml', 'emision_portal', 'emision_prueba')),
  is_test boolean NOT NULL DEFAULT false,
  version text,
  serie text,
  folio text,
  fecha timestamptz,
  rfc_emisor text,
  nombre_emisor text,
  rfc_receptor text,
  nombre_receptor text,
  tipo_comprobante text CHECK (tipo_comprobante IS NULL OR tipo_comprobante IN ('I', 'E', 'T', 'N', 'P')),
  uso_cfdi text,
  forma_pago text,
  metodo_pago text,
  moneda text,
  tipo_cambio numeric(18,6),
  subtotal numeric(14,2),
  descuento numeric(14,2),
  iva_trasladado numeric(14,2),
  iva_retenido numeric(14,2),
  isr_retenido numeric(14,2),
  total numeric(14,2),
  clave_prod_serv text,
  descripcion text,
  sat_status text NOT NULL DEFAULT 'desconocido' CHECK (sat_status IN ('vigente', 'cancelado', 'desconocido')),
  sat_status_checked_at timestamptz,
  xml_path text,
  pdf_path text,
  category_id uuid REFERENCES public.portal_expense_categories(id) ON DELETE SET NULL,
  category_status text NOT NULL DEFAULT 'sin_categoria'
    CHECK (category_status IN ('sin_categoria', 'regla', 'sugerida', 'confirmada')),
  suggested_category_id uuid REFERENCES public.portal_expense_categories(id) ON DELETE SET NULL,
  suggestion_model text,
  category_confirmed_by uuid,
  category_confirmed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, uuid)
);
ALTER TABLE public.portal_cfdi ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_cfdi_client_fecha ON public.portal_cfdi (client_id, direction, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_portal_cfdi_category_pending ON public.portal_cfdi (organization_id, category_status)
  WHERE category_status <> 'confirmada';

DROP TRIGGER IF EXISTS trg_portal_cfdi_org ON public.portal_cfdi;
CREATE TRIGGER trg_portal_cfdi_org
  BEFORE INSERT OR UPDATE OF client_id ON public.portal_cfdi
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();
DROP TRIGGER IF EXISTS update_portal_cfdi_updated_at ON public.portal_cfdi;
CREATE TRIGGER update_portal_cfdi_updated_at BEFORE UPDATE ON public.portal_cfdi
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Paso 1 de categorización: regla automática (queda 'regla', NO confirmada).
CREATE OR REPLACE FUNCTION public.portal_cfdi_apply_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_cat uuid;
BEGIN
  IF NEW.category_id IS NULL AND NEW.direction = 'recibida' THEN
    SELECT r.category_id INTO v_cat
      FROM public.portal_category_rules r
      JOIN public.portal_expense_categories k ON k.id = r.category_id AND k.active
     WHERE r.active
       AND r.organization_id = NEW.organization_id
       AND (r.client_id IS NULL OR r.client_id = NEW.client_id)
       AND (r.match_rfc_emisor IS NULL OR upper(r.match_rfc_emisor) = upper(COALESCE(NEW.rfc_emisor, '')))
       AND (r.match_clave_prefix IS NULL OR COALESCE(NEW.clave_prod_serv, '') LIKE r.match_clave_prefix || '%')
       AND (r.match_text IS NULL OR (COALESCE(NEW.descripcion, '') || ' ' || COALESCE(NEW.nombre_emisor, '')) ILIKE '%' || r.match_text || '%')
     ORDER BY (r.client_id IS NULL), r.priority, r.created_at
     LIMIT 1;
    IF v_cat IS NOT NULL THEN
      NEW.category_id := v_cat;
      NEW.category_status := 'regla';
    END IF;
  END IF;
  -- Nadie confirma al insertar: la confirmación es un acto de una persona.
  IF TG_OP = 'INSERT' AND NEW.category_status = 'confirmada' THEN
    NEW.category_status := CASE WHEN NEW.category_id IS NULL THEN 'sin_categoria' ELSE 'regla' END;
    NEW.category_confirmed_by := NULL;
    NEW.category_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_portal_cfdi_apply_rules ON public.portal_cfdi;
CREATE TRIGGER trg_portal_cfdi_apply_rules BEFORE INSERT ON public.portal_cfdi
  FOR EACH ROW EXECUTE FUNCTION public.portal_cfdi_apply_rules();

-- Marcas de no deducibilidad (informativas: nunca bloquean).
CREATE OR REPLACE FUNCTION public.portal_cfdi_flags(_direction text, _forma_pago text, _total numeric, _category_kind text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(f) FILTER (WHERE f IS NOT NULL), '[]'::jsonb) FROM (
    SELECT CASE WHEN _direction = 'recibida' AND _forma_pago = '01' AND COALESCE(_total, 0) > 2000 THEN
      jsonb_build_object('code', 'efectivo_mayor_2000',
        'reason', 'Pagado en efectivo por más de $2,000: no es deducible para ISR ni acreditable de IVA (art. 27, fr. III LISR).')
    END AS f
    UNION ALL
    SELECT CASE WHEN _direction = 'recibida' AND _forma_pago = '01' AND _category_kind = 'combustible' THEN
      jsonb_build_object('code', 'combustible_efectivo',
        'reason', 'Combustible pagado en efectivo: no es deducible aunque sea menor a $2,000 (art. 27, fr. III LISR).')
    END
    UNION ALL
    SELECT CASE WHEN _direction = 'recibida' AND _category_kind = 'restaurante' THEN
      jsonb_build_object('code', 'restaurante_8_5',
        'reason', 'Consumo en restaurante: solo 8.5% es deducible para ISR (art. 28, fr. XX LISR); el IVA sí es acreditable.')
    END
  ) s
$$;

-- Vista de lectura con marcas (respeta la RLS de portal_cfdi).
CREATE OR REPLACE VIEW public.portal_cfdi_v
WITH (security_invoker = true) AS
SELECT c.*,
       k.name AS category_name,
       k.kind AS category_kind,
       sk.name AS suggested_category_name,
       public.portal_cfdi_flags(c.direction, c.forma_pago, c.total, k.kind) AS flags
  FROM public.portal_cfdi c
  LEFT JOIN public.portal_expense_categories k ON k.id = c.category_id
  LEFT JOIN public.portal_expense_categories sk ON sk.id = c.suggested_category_id;

-- ── Expediente de emisión ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_instruction_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_document_id uuid REFERENCES public.portal_legal_documents(id),
  version text NOT NULL,
  signed_date date NOT NULL,
  storage_path text,
  registered_by uuid,
  registered_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid
);
ALTER TABLE public.portal_instruction_letters ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_letters_client ON public.portal_instruction_letters (client_id) WHERE revoked_at IS NULL;
DROP TRIGGER IF EXISTS trg_portal_letters_org ON public.portal_instruction_letters;
CREATE TRIGGER trg_portal_letters_org BEFORE INSERT OR UPDATE OF client_id ON public.portal_instruction_letters
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();

-- Registro del CSD para el portal (metadatos; sin cifrados).
CREATE TABLE IF NOT EXISTS public.portal_csd_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  certificate_id uuid NOT NULL UNIQUE REFERENCES public.client_sat_certificates(id) ON DELETE CASCADE,
  cert_serial text,
  cert_not_before timestamptz,
  cert_not_after timestamptz,
  registered_via text NOT NULL CHECK (registered_via IN ('portal', 'central')),
  registered_by uuid,
  registered_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  last_used_at timestamptz,
  use_count int NOT NULL DEFAULT 0
);
ALTER TABLE public.portal_csd_registry ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_csd_client ON public.portal_csd_registry (client_id) WHERE revoked_at IS NULL;

-- Contraseña de la llave privada del CSD, cifrada. Solo service_role.
CREATE TABLE IF NOT EXISTS public.portal_csd_secrets (
  certificate_id uuid PRIMARY KEY REFERENCES public.client_sat_certificates(id) ON DELETE CASCADE,
  password_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_csd_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_csd_secrets FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.portal_csd_secrets IS
  'Contraseña cifrada (AES-GCM, PORTAL_CSD_SECRET) de la llave del CSD. Sin policies ni privilegios para anon/authenticated. Nunca se devuelve.';

-- Defensa en profundidad: el portal jamás lee la tabla de certificados.
REVOKE ALL ON public.client_sat_certificates FROM anon;

CREATE OR REPLACE FUNCTION public.portal_emission_dossier(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_origin text;
  v_fiscal boolean;
  v_csd record;
  v_letter record;
  v_aviso public.portal_legal_documents := public.portal_current_legal('aviso_privacidad');
  v_contrato public.portal_legal_documents := public.portal_current_legal('contrato_uso');
  v_aviso_ok boolean;
  v_contrato_ok boolean;
  v_checks jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.portal_can_read_client(_client_id)
          OR public.portal_staff_in_client_org(auth.uid(), _client_id)
          OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(s.origin, 'kawiil') INTO v_origin FROM public.clients c
    LEFT JOIN public.portal_client_settings s ON s.client_id = c.id WHERE c.id = _client_id;

  SELECT EXISTS (SELECT 1 FROM public.fis_tax_profiles t
                  WHERE t.client_id = _client_id AND t.active AND t.is_default AND t.csf_verified_at IS NOT NULL)
    INTO v_fiscal;
  v_checks := v_checks || jsonb_build_object('key', 'datos_fiscales', 'ok', v_fiscal,
    'label', 'Datos fiscales verificados',
    'detail', CASE WHEN v_fiscal THEN 'Perfil fiscal predeterminado con constancia verificada.'
                   ELSE 'Falta un perfil fiscal predeterminado con la constancia de situación fiscal verificada por Kawiil.' END);

  SELECT r.cert_serial, r.cert_not_after, r.cert_not_before INTO v_csd
    FROM public.portal_csd_registry r
    JOIN public.client_sat_certificates c ON c.id = r.certificate_id AND c.cert_type = 'csd_sello'
    JOIN public.portal_csd_secrets s ON s.certificate_id = r.certificate_id
   WHERE r.client_id = _client_id AND r.revoked_at IS NULL
     AND c.cert_not_after > now() AND (c.cert_not_before IS NULL OR c.cert_not_before <= now())
   ORDER BY c.cert_not_after DESC LIMIT 1;
  v_checks := v_checks || jsonb_build_object('key', 'csd', 'ok', v_csd.cert_not_after IS NOT NULL,
    'label', 'Certificado de sello digital cargado y vigente',
    'detail', CASE WHEN v_csd.cert_not_after IS NOT NULL
                   THEN 'Serie ' || COALESCE(v_csd.cert_serial, '—') || ', vence ' || to_char(v_csd.cert_not_after AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY')
                   ELSE 'No hay un CSD vigente y sin revocar cargado para el portal.' END);

  IF v_origin = 'basico' THEN
    SELECT EXISTS (SELECT 1 FROM public.portal_legal_acceptances a
                    JOIN public.portal_memberships m ON m.user_id = a.user_id AND m.client_id = _client_id
                                                    AND m.role = 'administrador' AND m.status = 'activa'
                   WHERE a.document_id = v_contrato.id) INTO v_contrato_ok;
    v_checks := v_checks || jsonb_build_object('key', 'contrato_uso', 'ok', COALESCE(v_contrato_ok, false),
      'label', 'Contrato de uso aceptado',
      'detail', CASE WHEN v_contrato_ok THEN 'Versión ' || v_contrato.version || ' aceptada.'
                     ELSE 'Un administrador debe aceptar el contrato de uso vigente' ||
                          COALESCE(' (versión ' || v_contrato.version || ')', '') || '.' END);
  ELSE
    SELECT l.version, l.signed_date INTO v_letter FROM public.portal_instruction_letters l
     WHERE l.client_id = _client_id AND l.revoked_at IS NULL ORDER BY l.registered_at DESC LIMIT 1;
    v_checks := v_checks || jsonb_build_object('key', 'carta_instruccion', 'ok', v_letter.version IS NOT NULL,
      'label', 'Carta de instrucción registrada',
      'detail', CASE WHEN v_letter.version IS NOT NULL
                     THEN 'Versión ' || v_letter.version || ' firmada el ' || to_char(v_letter.signed_date, 'DD/MM/YYYY') || '.'
                     ELSE 'Kawiil debe registrar la carta de instrucción firmada (versión y fecha).' END);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.portal_legal_acceptances a
                  JOIN public.portal_memberships m ON m.user_id = a.user_id AND m.client_id = _client_id
                                                  AND m.role = 'administrador' AND m.status = 'activa'
                 WHERE a.document_id = v_aviso.id) INTO v_aviso_ok;
  v_checks := v_checks || jsonb_build_object('key', 'aviso_privacidad', 'ok', COALESCE(v_aviso_ok, false),
    'label', 'Aviso de privacidad aceptado',
    'detail', CASE WHEN v_aviso_ok THEN 'Versión ' || v_aviso.version || ' aceptada por un administrador.'
                   ELSE 'Un administrador del cliente debe aceptar el aviso de privacidad vigente.' END);

  RETURN jsonb_build_object(
    'client_id', _client_id,
    'origin', v_origin,
    'complete', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) e WHERE NOT (e->>'ok')::boolean),
    'checks', v_checks
  );
END;
$$;
REVOKE ALL ON FUNCTION public.portal_emission_dossier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_emission_dossier(uuid) TO authenticated, service_role;

-- La BASE impide prender la emisión con el expediente incompleto.
CREATE OR REPLACE FUNCTION public.portal_guard_emission_switch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_d jsonb;
BEGIN
  IF NEW.emission_enabled AND (TG_OP = 'INSERT' OR NOT OLD.emission_enabled) THEN
    v_d := public.portal_emission_dossier(NEW.client_id);
    IF NOT (v_d->>'complete')::boolean THEN
      RAISE EXCEPTION 'Expediente de emisión incompleto: %',
        (SELECT string_agg(e->>'label', '; ') FROM jsonb_array_elements(v_d->'checks') e WHERE NOT (e->>'ok')::boolean)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_guard_emission_switch() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_portal_guard_emission_switch ON public.portal_client_settings;
CREATE TRIGGER trg_portal_guard_emission_switch BEFORE INSERT OR UPDATE OF emission_enabled ON public.portal_client_settings
  FOR EACH ROW EXECUTE FUNCTION public.portal_guard_emission_switch();

-- ── Emisiones y cancelaciones ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_emissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_by uuid,
  emisor text NOT NULL CHECK (emisor IN ('prueba', 'pac')),
  status text NOT NULL CHECK (status IN ('rechazada', 'emitida', 'error')),
  draft jsonb NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  cfdi_id uuid REFERENCES public.portal_cfdi(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_emissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_portal_emissions_client ON public.portal_emissions (client_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_portal_emissions_org ON public.portal_emissions;
CREATE TRIGGER trg_portal_emissions_org BEFORE INSERT OR UPDATE OF client_id ON public.portal_emissions
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();

CREATE TABLE IF NOT EXISTS public.portal_cancel_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cfdi_id uuid NOT NULL REFERENCES public.portal_cfdi(id) ON DELETE CASCADE,
  -- Motivos del SAT: 01 con relación, 02 sin relación, 03 no se llevó a cabo, 04 nominativa en global.
  motivo text NOT NULL CHECK (motivo IN ('01', '02', '03', '04')),
  folio_sustitucion text CHECK (folio_sustitucion IS NULL OR upper(folio_sustitucion) ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  comment text,
  status text NOT NULL DEFAULT 'solicitada' CHECK (status IN ('solicitada', 'en_revision', 'ejecutada', 'rechazada')),
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  CONSTRAINT portal_cancel_motivo01 CHECK (motivo <> '01' OR folio_sustitucion IS NOT NULL)
);
ALTER TABLE public.portal_cancel_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_cancel_open ON public.portal_cancel_requests (cfdi_id)
  WHERE status IN ('solicitada', 'en_revision');
DROP TRIGGER IF EXISTS trg_portal_cancel_org ON public.portal_cancel_requests;
CREATE TRIGGER trg_portal_cancel_org BEFORE INSERT OR UPDATE OF client_id ON public.portal_cancel_requests
  FOR EACH ROW EXECUTE FUNCTION public.portal_inherit_client_org();

-- ── RLS ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS portal_categories_select ON public.portal_expense_categories;
CREATE POLICY portal_categories_select ON public.portal_expense_categories
  FOR SELECT TO authenticated USING (
    (public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()))
    OR public.portal_can_read_org(organization_id));
DROP POLICY IF EXISTS portal_categories_write ON public.portal_expense_categories;
CREATE POLICY portal_categories_write ON public.portal_expense_categories
  FOR ALL TO authenticated
  USING (public.portal_is_staff_admin(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (public.portal_is_staff_admin(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS portal_rules_staff ON public.portal_category_rules;
CREATE POLICY portal_rules_staff ON public.portal_category_rules
  FOR ALL TO authenticated
  USING (public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (public.portal_is_staff_admin(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS portal_cfdi_select_portal ON public.portal_cfdi;
CREATE POLICY portal_cfdi_select_portal ON public.portal_cfdi
  FOR SELECT TO authenticated USING (public.portal_can_read_client(client_id));
DROP POLICY IF EXISTS portal_cfdi_select_staff ON public.portal_cfdi;
CREATE POLICY portal_cfdi_select_staff ON public.portal_cfdi
  FOR SELECT TO authenticated USING (
    public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS portal_letters_select ON public.portal_instruction_letters;
CREATE POLICY portal_letters_select ON public.portal_instruction_letters
  FOR SELECT TO authenticated USING (
    public.portal_can_read_client(client_id)
    OR (public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid())));

DROP POLICY IF EXISTS portal_csd_registry_select ON public.portal_csd_registry;
CREATE POLICY portal_csd_registry_select ON public.portal_csd_registry
  FOR SELECT TO authenticated USING (
    public.portal_has_client_role(client_id, ARRAY['administrador'])
    OR (public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid())));

DROP POLICY IF EXISTS portal_emissions_select ON public.portal_emissions;
CREATE POLICY portal_emissions_select ON public.portal_emissions
  FOR SELECT TO authenticated USING (
    public.portal_can_read_client(client_id)
    OR (public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid())));

DROP POLICY IF EXISTS portal_cancel_select ON public.portal_cancel_requests;
CREATE POLICY portal_cancel_select ON public.portal_cancel_requests
  FOR SELECT TO authenticated USING (
    public.portal_can_read_client(client_id)
    OR (public.portal_is_staff(auth.uid()) AND organization_id = public.get_user_org_id(auth.uid())));

REVOKE INSERT, UPDATE, DELETE ON public.portal_cfdi, public.portal_instruction_letters, public.portal_csd_registry,
  public.portal_emissions, public.portal_cancel_requests FROM anon, authenticated;

-- ── RPC ─────────────────────────────────────────────────────────────

-- Tablero de gasto. Información de gestión: NO sustituye la declaración.
CREATE OR REPLACE FUNCTION public.portal_dashboard(_client_id uuid, _year int, _month int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_tz text := 'America/Mexico_City';
  v jsonb;
BEGIN
  IF NOT (public.portal_has_client_role(_client_id, ARRAY['administrador', 'consulta'])
          OR public.portal_staff_in_client_org(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'Sin permiso para ver el tablero' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_start := make_timestamptz(_year, _month, 1, 0, 0, 0, v_tz);
  v_end := v_start + interval '1 month';
  v_prev_start := v_start - interval '1 month';

  WITH base AS (
    SELECT c.*, k.name AS cat_name, k.kind AS cat_kind,
           CASE WHEN c.tipo_comprobante = 'E' THEN -1 ELSE 1 END *
             COALESCE(c.total, 0) * COALESCE(NULLIF(c.tipo_cambio, 0), 1) AS monto,
           public.portal_cfdi_flags(c.direction, c.forma_pago, c.total, k.kind) AS flags
      FROM public.portal_cfdi c
      LEFT JOIN public.portal_expense_categories k ON k.id = c.category_id AND c.category_status = 'confirmada'
     WHERE c.client_id = _client_id AND NOT c.is_test AND c.sat_status <> 'cancelado'
       AND c.tipo_comprobante IN ('I', 'E')
  ),
  mes AS (SELECT * FROM base WHERE fecha >= v_start AND fecha < v_end),
  prev AS (SELECT * FROM base WHERE fecha >= v_prev_start AND fecha < v_start)
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('year', _year, 'month', _month),
    'leyenda', 'Información de gestión, no sustituye la declaración.',
    'gasto_total', (SELECT COALESCE(sum(monto), 0) FROM mes WHERE direction = 'recibida'),
    'gasto_mes_anterior', (SELECT COALESCE(sum(monto), 0) FROM prev WHERE direction = 'recibida'),
    'ingreso_total', (SELECT COALESCE(sum(monto), 0) FROM mes WHERE direction = 'emitida'),
    'ingreso_mes_anterior', (SELECT COALESCE(sum(monto), 0) FROM prev WHERE direction = 'emitida'),
    'por_categoria', (SELECT COALESCE(jsonb_agg(x ORDER BY x.total DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(cat_name, 'Por confirmar') AS categoria, (cat_name IS NULL) AS por_confirmar,
               sum(monto) AS total, count(*) AS facturas
          FROM mes WHERE direction = 'recibida' GROUP BY cat_name) x),
    'por_proveedor', (SELECT COALESCE(jsonb_agg(x ORDER BY x.total DESC), '[]'::jsonb) FROM (
        SELECT rfc_emisor AS rfc, max(nombre_emisor) AS nombre, sum(monto) AS total, count(*) AS facturas
          FROM mes WHERE direction = 'recibida' GROUP BY rfc_emisor ORDER BY sum(monto) DESC LIMIT 10) x),
    'por_mes', (SELECT COALESCE(jsonb_agg(x ORDER BY x.mes), '[]'::jsonb) FROM (
        SELECT to_char(date_trunc('month', fecha AT TIME ZONE v_tz), 'YYYY-MM') AS mes,
               sum(monto) FILTER (WHERE direction = 'recibida') AS gasto,
               sum(monto) FILTER (WHERE direction = 'emitida') AS ingreso
          FROM base
         WHERE fecha >= v_start - interval '11 months' AND fecha < v_end
         GROUP BY 1) x),
    'iva', (SELECT jsonb_build_object(
        'trasladado', COALESCE(sum(iva_trasladado) FILTER (WHERE direction = 'emitida'), 0),
        'acreditable', COALESCE(sum(iva_trasladado) FILTER (WHERE direction = 'recibida'
                                    AND NOT flags @> '[{"code":"efectivo_mayor_2000"}]'::jsonb
                                    AND NOT flags @> '[{"code":"combustible_efectivo"}]'::jsonb), 0),
        'facturas_sin_desglose', count(*) FILTER (WHERE iva_trasladado IS NULL)
      ) FROM mes),
    'marcas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'cfdi_id', id, 'uuid', uuid, 'emisor', nombre_emisor, 'total', total, 'fecha', fecha, 'flags', flags)
          ORDER BY fecha DESC), '[]'::jsonb)
        FROM mes WHERE jsonb_array_length(flags) > 0),
    'por_confirmar', (SELECT count(*) FROM mes WHERE direction = 'recibida' AND cat_name IS NULL)
  ) INTO v;

  v := v || jsonb_build_object('iva_estimado',
    (v->'iva'->>'trasladado')::numeric - (v->'iva'->>'acreditable')::numeric);
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_dashboard(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_dashboard(uuid, int, int) TO authenticated;

-- Paso 3 de categorización: confirmación de una persona de Kawiil.
CREATE OR REPLACE FUNCTION public.portal_staff_confirm_category(_cfdi_ids uuid[], _category_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_n int; v_org uuid := public.get_user_org_id(auth.uid()); r record;
BEGIN
  IF NOT public.portal_is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Solo el equipo de Kawiil confirma categorías' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_expense_categories WHERE id = _category_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Categoría inválida';
  END IF;
  UPDATE public.portal_cfdi SET category_id = _category_id, category_status = 'confirmada',
         category_confirmed_by = auth.uid(), category_confirmed_at = now()
   WHERE id = ANY (_cfdi_ids) AND organization_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  FOR r IN SELECT id, client_id FROM public.portal_cfdi WHERE id = ANY (_cfdi_ids) AND organization_id = v_org LOOP
    PERFORM public.portal_audit('categoria_confirmada', r.client_id, 'portal_cfdi', r.id::text,
      jsonb_build_object('category_id', _category_id));
  END LOOP;
  RETURN v_n;
END;
$$;

-- Paso 2: sugerencia del modelo (solo la escribe service_role desde portal-api).
CREATE OR REPLACE FUNCTION public.portal_set_category_suggestion(_cfdi_id uuid, _category_id uuid, _model text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  UPDATE public.portal_cfdi c SET suggested_category_id = _category_id, suggestion_model = left(_model, 120),
         category_status = CASE WHEN c.category_status = 'confirmada' THEN c.category_status ELSE 'sugerida' END
   WHERE c.id = _cfdi_id
     AND EXISTS (SELECT 1 FROM public.portal_expense_categories k WHERE k.id = _category_id AND k.organization_id = c.organization_id);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_set_category_suggestion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_set_category_suggestion(uuid, uuid, text) TO service_role;

-- Importación del detalle que ya devuelve `moffin-facturas` (sin tocar esa función).
-- _cfdis: arreglo de MoffinCfdiNormalized (uuid, fechaCFDI, rfcEmisor, rfcReceptor, emisor,
-- receptor, tipo, direccion, estatus, vigente, total).
CREATE OR REPLACE FUNCTION public.portal_staff_import_moffin_cfdi(_client_id uuid, _cfdis jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_rfc text;
  v_new int := 0; v_upd int := 0; v_skip int := 0;
  e jsonb; v_uuid text; v_dir text; v_tipo text; v_ins boolean;
BEGIN
  IF NOT public.portal_staff_in_client_org(auth.uid(), _client_id) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT upper(rfc) INTO v_rfc FROM public.clients WHERE id = _client_id;
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(_cfdis, '[]'::jsonb)) LOOP
    v_uuid := upper(e->>'uuid');
    v_dir := e->>'direccion';
    IF v_uuid IS NULL OR v_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'
       OR v_dir NOT IN ('emitida', 'recibida')
       OR (v_dir = 'emitida' AND upper(COALESCE(e->>'rfcEmisor', '')) <> v_rfc)
       OR (v_dir = 'recibida' AND upper(COALESCE(e->>'rfcReceptor', '')) <> v_rfc) THEN
      v_skip := v_skip + 1; CONTINUE;
    END IF;
    v_tipo := CASE lower(COALESCE(e->>'tipo', ''))
                WHEN 'ingreso' THEN 'I' WHEN 'i' THEN 'I' WHEN 'egreso' THEN 'E' WHEN 'e' THEN 'E'
                WHEN 'pago' THEN 'P' WHEN 'p' THEN 'P' WHEN 'nomina' THEN 'N' WHEN 'nómina' THEN 'N'
                WHEN 'n' THEN 'N' WHEN 'traslado' THEN 'T' WHEN 't' THEN 'T' ELSE NULL END;
    INSERT INTO public.portal_cfdi (organization_id, client_id, uuid, direction, source, fecha,
      rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor, tipo_comprobante, total,
      sat_status, sat_status_checked_at, created_by)
    VALUES ('00000000-0000-0000-0000-000000000000', _client_id, v_uuid, v_dir, 'moffin',
      NULLIF(e->>'fechaCFDI', '')::timestamptz,
      upper(e->>'rfcEmisor'), e->>'emisor', upper(e->>'rfcReceptor'), e->>'receptor', v_tipo,
      NULLIF(e->>'total', '')::numeric,
      CASE WHEN (e->>'vigente')::boolean THEN 'vigente'
           WHEN e->>'estatus' ILIKE '%cancel%' THEN 'cancelado' ELSE 'desconocido' END,
      now(), auth.uid())
    ON CONFLICT (client_id, uuid) DO UPDATE
      SET sat_status = excluded.sat_status, sat_status_checked_at = now()
    RETURNING (xmax = 0) INTO v_ins;
    IF v_ins THEN v_new := v_new + 1; ELSE v_upd := v_upd + 1; END IF;
  END LOOP;
  PERFORM public.portal_audit('cfdi_importacion', _client_id, 'portal_cfdi', NULL,
    jsonb_build_object('fuente', 'moffin', 'nuevas', v_new, 'actualizadas', v_upd, 'omitidas', v_skip));
  RETURN jsonb_build_object('nuevas', v_new, 'actualizadas', v_upd, 'omitidas', v_skip);
END;
$$;

-- Interruptor de emisión por cliente (el trigger valida el expediente).
CREATE OR REPLACE FUNCTION public.portal_staff_set_emission(_client_id uuid, _enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NOT (public.portal_is_staff_admin(auth.uid()) AND public.portal_staff_in_client_org(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'Solo G3/G4' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.portal_client_settings (client_id, organization_id)
  SELECT _client_id, c.organization_id FROM public.clients c WHERE c.id = _client_id
  ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.portal_client_settings
     SET emission_enabled = _enabled, emission_changed_at = now(), emission_changed_by = auth.uid()
   WHERE client_id = _client_id;
  PERFORM public.portal_audit('emision_interruptor', _client_id, 'portal_client_settings', _client_id::text,
    jsonb_build_object('enabled', _enabled));
  RETURN public.portal_emission_dossier(_client_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_register_instruction_letter(
  _client_id uuid, _version text, _signed_date date, _storage_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_id uuid; v_tpl public.portal_legal_documents := public.portal_current_legal('carta_instruccion');
BEGIN
  IF NOT (public.portal_is_staff_admin(auth.uid()) AND public.portal_staff_in_client_org(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'Solo G3/G4' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(COALESCE(_version, '')) = '' OR _signed_date IS NULL OR _signed_date > current_date THEN
    RAISE EXCEPTION 'Versión y fecha de firma (no futura) son obligatorias';
  END IF;
  UPDATE public.portal_instruction_letters SET revoked_at = now(), revoked_by = auth.uid()
   WHERE client_id = _client_id AND revoked_at IS NULL;
  INSERT INTO public.portal_instruction_letters (organization_id, client_id, template_document_id, version, signed_date, storage_path, registered_by)
  VALUES ('00000000-0000-0000-0000-000000000000', _client_id, v_tpl.id, btrim(_version), _signed_date, _storage_path, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.portal_audit('carta_instruccion_registro', _client_id, 'portal_instruction_letters', v_id::text,
    jsonb_build_object('version', _version, 'signed_date', _signed_date));
  RETURN v_id;
END;
$$;

-- El cliente solicita la cancelación; la ejecuta Kawiil.
CREATE OR REPLACE FUNCTION public.portal_cancel_request(_cfdi_id uuid, _motivo text, _folio_sustitucion text DEFAULT NULL, _comment text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_c public.portal_cfdi; v_id uuid;
BEGIN
  SELECT * INTO v_c FROM public.portal_cfdi WHERE id = _cfdi_id;
  IF NOT FOUND OR NOT public.portal_has_client_role(v_c.client_id, ARRAY['administrador']) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_c.direction <> 'emitida' THEN RAISE EXCEPTION 'Solo se solicita cancelar facturas emitidas'; END IF;
  IF v_c.sat_status = 'cancelado' THEN RAISE EXCEPTION 'La factura ya está cancelada'; END IF;
  INSERT INTO public.portal_cancel_requests (organization_id, client_id, cfdi_id, motivo, folio_sustitucion, comment, requested_by)
  VALUES (v_c.organization_id, v_c.client_id, _cfdi_id, _motivo, upper(NULLIF(btrim(_folio_sustitucion), '')), left(_comment, 1000), auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.portal_audit('cancelacion_solicitud', v_c.client_id, 'portal_cancel_requests', v_id::text,
    jsonb_build_object('cfdi_uuid', v_c.uuid, 'motivo', _motivo));
  PERFORM public.portal_enqueue('slack', 'cancelacion_solicitada', v_c.client_id,
    jsonb_build_object('cfdi_uuid', v_c.uuid, 'motivo', _motivo, 'request_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_resolve_cancel(_request_id uuid, _status text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_r public.portal_cancel_requests;
BEGIN
  SELECT * INTO v_r FROM public.portal_cancel_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.portal_is_staff_admin(auth.uid()) AND public.portal_staff_in_client_org(auth.uid(), v_r.client_id)) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _status NOT IN ('en_revision', 'ejecutada', 'rechazada') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE public.portal_cancel_requests
     SET status = _status, resolution_note = left(_note, 1000),
         resolved_by = CASE WHEN _status IN ('ejecutada', 'rechazada') THEN auth.uid() END,
         resolved_at = CASE WHEN _status IN ('ejecutada', 'rechazada') THEN now() END
   WHERE id = _request_id;
  IF _status = 'ejecutada' THEN
    UPDATE public.portal_cfdi SET sat_status = 'cancelado', sat_status_checked_at = now() WHERE id = v_r.cfdi_id;
  END IF;
  PERFORM public.portal_audit('cancelacion_resolucion', v_r.client_id, 'portal_cancel_requests', _request_id::text,
    jsonb_build_object('status', _status));
END;
$$;

-- Estado del CSD para mostrar (solo metadatos). Nunca devuelve cifrados.
CREATE OR REPLACE FUNCTION public.portal_csd_status(_client_id uuid)
RETURNS TABLE (registry_id uuid, cert_serial text, cert_not_before timestamptz, cert_not_after timestamptz,
               registered_via text, registered_at timestamptz, revoked_at timestamptz,
               last_used_at timestamptz, use_count int, days_to_expiry int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT r.id, r.cert_serial, r.cert_not_before, r.cert_not_after, r.registered_via, r.registered_at,
         r.revoked_at, r.last_used_at, r.use_count,
         CASE WHEN r.cert_not_after IS NULL THEN NULL
              ELSE (date_part('day', r.cert_not_after - now()))::int END
    FROM public.portal_csd_registry r
   WHERE r.client_id = _client_id
     AND (public.portal_has_client_role(_client_id, ARRAY['administrador'])
          OR public.portal_staff_in_client_org(auth.uid(), _client_id))
   ORDER BY r.registered_at DESC
$$;

-- Uso de facturas del nivel básico.
CREATE OR REPLACE FUNCTION public.portal_basic_usage(_client_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT jsonb_build_object(
    'usadas', (SELECT count(*) FROM public.portal_emissions e WHERE e.client_id = _client_id AND e.status = 'emitida'),
    'limite', COALESCE(s.basic_invoice_limit, cfg.default_basic_invoice_limit),
    'origin', COALESCE(s.origin, 'kawiil'))
    FROM public.clients c
    LEFT JOIN public.portal_client_settings s ON s.client_id = c.id
    LEFT JOIN public.portal_config cfg ON cfg.id
   WHERE c.id = _client_id
     AND (public.portal_can_read_client(_client_id) OR public.portal_staff_in_client_org(auth.uid(), _client_id)
          OR auth.uid() IS NULL)
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_staff_confirm_category(uuid[], uuid)',
    'portal_staff_import_moffin_cfdi(uuid, jsonb)',
    'portal_staff_set_emission(uuid, boolean)',
    'portal_staff_register_instruction_letter(uuid, text, date, text)',
    'portal_cancel_request(uuid, text, text, text)',
    'portal_staff_resolve_cancel(uuid, text, text)',
    'portal_csd_status(uuid)',
    'portal_basic_usage(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
