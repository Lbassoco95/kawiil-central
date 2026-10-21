-- Facturación guiada (Facturapi): catálogos SAT indexados, plantillas frecuentes
-- y registro de emisiones. Fase 1: UX en OS; llaves Facturapi pueden vivir en central.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Catálogos SAT (ClaveProdServ, ClaveUnidad, etc.) ─────────────────
CREATE TABLE IF NOT EXISTS public.sat_catalog_entries (
  id bigserial PRIMARY KEY,
  catalog text NOT NULL CHECK (catalog IN (
    'c_ClaveProdServ', 'c_ClaveUnidad', 'c_FormaPago', 'c_MetodoPago',
    'c_UsoCFDI', 'c_RegimenFiscal'
  )),
  clave text NOT NULL,
  descripcion text NOT NULL,
  synonyms text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  search_text text NOT NULL DEFAULT '',
  UNIQUE (catalog, clave)
);

CREATE OR REPLACE FUNCTION public.sat_catalog_entries_set_search()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_text := lower(NEW.clave || ' ' || NEW.descripcion || ' ' || coalesce(array_to_string(NEW.synonyms, ' '), ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sat_catalog_entries_search ON public.sat_catalog_entries;
CREATE TRIGGER trg_sat_catalog_entries_search
  BEFORE INSERT OR UPDATE OF clave, descripcion, synonyms
  ON public.sat_catalog_entries
  FOR EACH ROW EXECUTE FUNCTION public.sat_catalog_entries_set_search();

CREATE INDEX IF NOT EXISTS sat_catalog_entries_catalog_clave_idx
  ON public.sat_catalog_entries (catalog, clave);
CREATE INDEX IF NOT EXISTS sat_catalog_entries_trgm_idx
  ON public.sat_catalog_entries USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sat_catalog_entries_fts_idx
  ON public.sat_catalog_entries USING gin (
    to_tsvector('spanish', coalesce(search_text, ''))
  );

COMMENT ON TABLE public.sat_catalog_entries IS
  'Catálogos SAT para sugerir claves al facturar. Semilla parcial de ClaveProdServ; carga completa vía tools/portal/seed-sat-catalogs.';

-- ── Conceptos frecuentes (por cliente) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_concept_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  internal_id text NOT NULL,
  label text NOT NULL,
  descripcion text NOT NULL,
  clave_prod_serv text NOT NULL CHECK (clave_prod_serv ~ '^[0-9]{8}$'),
  clave_unidad text NOT NULL DEFAULT 'E48',
  cantidad numeric NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  valor_unitario numeric NOT NULL DEFAULT 0 CHECK (valor_unitario >= 0),
  objeto_imp text NOT NULL DEFAULT '02' CHECK (objeto_imp IN ('01', '02')),
  iva_tasa numeric CHECK (iva_tasa IS NULL OR iva_tasa IN (0, 0.08, 0.16)),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, internal_id)
);

CREATE INDEX IF NOT EXISTS portal_concept_templates_client_idx
  ON public.portal_concept_templates (client_id, updated_at DESC);

-- ── Facturas frecuentes (plantilla completa) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_invoice_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  internal_id text NOT NULL,
  label text NOT NULL,
  receptor_rfc text,
  receptor_nombre text,
  receptor_regimen text,
  receptor_cp text,
  uso_cfdi text NOT NULL DEFAULT 'G03',
  forma_pago text NOT NULL DEFAULT '03',
  metodo_pago text NOT NULL DEFAULT 'PUE' CHECK (metodo_pago IN ('PUE', 'PPD')),
  conceptos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, internal_id)
);

CREATE INDEX IF NOT EXISTS portal_invoice_templates_client_idx
  ON public.portal_invoice_templates (client_id, updated_at DESC);

-- ── Emisiones / vínculo Facturapi ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_emissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  emisor text NOT NULL CHECK (emisor IN ('prueba', 'pac', 'facturapi')),
  status text NOT NULL CHECK (status IN ('emitida', 'rechazada', 'pendiente')),
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb,
  cfdi_id uuid REFERENCES public.portal_cfdi(id) ON DELETE SET NULL,
  facturapi_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_emissions_client_idx
  ON public.portal_emissions (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.portal_facturapi_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  cfdi_id uuid REFERENCES public.portal_cfdi(id) ON DELETE SET NULL,
  facturapi_id text NOT NULL,
  uuid text,
  tipo text NOT NULL CHECK (tipo IN ('I', 'P', 'E')),
  livemode boolean NOT NULL DEFAULT false,
  status text,
  related_uuid text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, facturapi_id)
);

CREATE INDEX IF NOT EXISTS portal_facturapi_invoices_client_idx
  ON public.portal_facturapi_invoices (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_facturapi_invoices_uuid_idx
  ON public.portal_facturapi_invoices (client_id, uuid);

-- RLS
ALTER TABLE public.sat_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_concept_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_emissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_facturapi_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sat_catalog_select ON public.sat_catalog_entries;
CREATE POLICY sat_catalog_select ON public.sat_catalog_entries
  FOR SELECT TO authenticated
  USING (active = true);

DROP POLICY IF EXISTS concept_templates_all ON public.portal_concept_templates;
CREATE POLICY concept_templates_select ON public.portal_concept_templates
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY concept_templates_write ON public.portal_concept_templates
  FOR ALL TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo']::public.portal_role[]))
  WITH CHECK (public.portal_has_company_role(client_id, ARRAY['administrador','operativo']::public.portal_role[]));

DROP POLICY IF EXISTS invoice_templates_all ON public.portal_invoice_templates;
CREATE POLICY invoice_templates_select ON public.portal_invoice_templates
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));
CREATE POLICY invoice_templates_write ON public.portal_invoice_templates
  FOR ALL TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo']::public.portal_role[]))
  WITH CHECK (public.portal_has_company_role(client_id, ARRAY['administrador','operativo']::public.portal_role[]));

CREATE POLICY emissions_select ON public.portal_emissions
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));

CREATE POLICY facturapi_invoices_select ON public.portal_facturapi_invoices
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));

GRANT SELECT ON public.sat_catalog_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_concept_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_invoice_templates TO authenticated;
GRANT SELECT ON public.portal_emissions TO authenticated;
GRANT SELECT ON public.portal_facturapi_invoices TO authenticated;
GRANT ALL ON public.sat_catalog_entries TO service_role;
GRANT ALL ON public.portal_concept_templates TO service_role;
GRANT ALL ON public.portal_invoice_templates TO service_role;
GRANT ALL ON public.portal_emissions TO service_role;
GRANT ALL ON public.portal_facturapi_invoices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sat_catalog_entries_id_seq TO authenticated, service_role;

-- Búsqueda aproximada por concepto → ClaveProdServ / unidad
CREATE OR REPLACE FUNCTION public.portal_sat_catalog_suggest(
  _catalog text,
  _q text,
  _limit integer DEFAULT 12
)
RETURNS TABLE (clave text, descripcion text, score real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT e.clave, e.descripcion,
    greatest(
      similarity(e.search_text, lower(trim(_q))),
      CASE WHEN e.clave LIKE regexp_replace(trim(_q), '[^0-9]', '', 'g') || '%' THEN 0.95 ELSE 0 END,
      ts_rank(to_tsvector('spanish', e.search_text), plainto_tsquery('spanish', coalesce(nullif(trim(_q), ''), 'x')))
    )::real AS score
  FROM public.sat_catalog_entries e
  WHERE e.catalog = _catalog
    AND e.active
    AND (
      e.search_text % lower(trim(_q))
      OR e.clave LIKE regexp_replace(trim(_q), '[^0-9A-Za-z]', '', 'g') || '%'
      OR to_tsvector('spanish', e.search_text) @@ plainto_tsquery('spanish', coalesce(nullif(trim(_q), ''), 'x'))
    )
  ORDER BY score DESC, e.clave
  LIMIT greatest(1, least(coalesce(_limit, 12), 40));
$$;

REVOKE ALL ON FUNCTION public.portal_sat_catalog_suggest(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_sat_catalog_suggest(text, text, integer) TO authenticated, service_role;

-- Semilla: unidades frecuentes + ClaveProdServ de servicios profesionales / contables
INSERT INTO public.sat_catalog_entries (catalog, clave, descripcion, synonyms) VALUES
  ('c_ClaveUnidad', 'E48', 'Unidad de servicio', ARRAY['servicio','servicios','act']),
  ('c_ClaveUnidad', 'H87', 'Pieza', ARRAY['pieza','pza','unidad']),
  ('c_ClaveUnidad', 'ACT', 'Actividad', ARRAY['actividad']),
  ('c_ClaveUnidad', 'E51', 'Trabajo', ARRAY['trabajo','job']),
  ('c_ClaveUnidad', 'XUN', 'Unidad', ARRAY['unidad']),
  ('c_ClaveUnidad', 'HUR', 'Hora', ARRAY['hora','horas']),
  ('c_ClaveUnidad', 'DAY', 'Día', ARRAY['dia','días','dias']),
  ('c_ClaveUnidad', 'MON', 'Mes', ARRAY['mes','mensual']),
  ('c_ClaveUnidad', 'A9', 'Tarifa', ARRAY['tarifa']),
  ('c_ClaveUnidad', 'KGM', 'Kilogramo', ARRAY['kg','kilo']),
  ('c_ClaveUnidad', 'LTR', 'Litro', ARRAY['litro','lt']),
  ('c_ClaveUnidad', 'MTR', 'Metro', ARRAY['metro']),
  ('c_ClaveProdServ', '80101500', 'Servicios de consultoría de negocios', ARRAY['consultoria','asesoria','negocios']),
  ('c_ClaveProdServ', '80101501', 'Servicios de consultoría en planeación estratégica', ARRAY['planeacion','estrategia']),
  ('c_ClaveProdServ', '80101502', 'Servicios de consultoría en organización', ARRAY['organizacion']),
  ('c_ClaveProdServ', '80101504', 'Servicios de consultoría en gestión de proyectos', ARRAY['proyectos','pm']),
  ('c_ClaveProdServ', '80101505', 'Servicios de consultoría en gestión de calidad', ARRAY['calidad']),
  ('c_ClaveProdServ', '80101506', 'Servicios de consultoría en gestión de riesgos', ARRAY['riesgos']),
  ('c_ClaveProdServ', '80101507', 'Servicios de consultoría en recursos humanos', ARRAY['rh','rrhh','recursos humanos']),
  ('c_ClaveProdServ', '80101600', 'Servicios de gestión de proyectos', ARRAY['gestion de proyectos']),
  ('c_ClaveProdServ', '80111500', 'Servicios de desarrollo de recursos humanos', ARRAY['capacitacion rh']),
  ('c_ClaveProdServ', '80111600', 'Servicios de personal temporal', ARRAY['outsourcing','personal']),
  ('c_ClaveProdServ', '80121500', 'Servicios de asesoría legal', ARRAY['legal','juridico','abogado']),
  ('c_ClaveProdServ', '80121600', 'Servicios de representación legal', ARRAY['representacion legal']),
  ('c_ClaveProdServ', '80131500', 'Servicios de contabilidad', ARRAY['contabilidad','contable','contador']),
  ('c_ClaveProdServ', '80131501', 'Servicios de auditoría', ARRAY['auditoria']),
  ('c_ClaveProdServ', '80131502', 'Servicios de preparación de impuestos', ARRAY['impuestos','fiscal','declaracion','isr','iva']),
  ('c_ClaveProdServ', '80131503', 'Servicios de nómina', ARRAY['nomina','payroll']),
  ('c_ClaveProdServ', '80131504', 'Servicios de teneduría de libros', ARRAY['libros','bookkeeping']),
  ('c_ClaveProdServ', '80141600', 'Servicios de gestión de instalaciones', ARRAY['facilidades']),
  ('c_ClaveProdServ', '80161500', 'Servicios de administración de empresas', ARRAY['administracion']),
  ('c_ClaveProdServ', '80161501', 'Servicios de administración de oficinas', ARRAY['oficina']),
  ('c_ClaveProdServ', '80161502', 'Servicios de apoyo administrativo', ARRAY['apoyo administrativo']),
  ('c_ClaveProdServ', '80171500', 'Servicios de gestión de compras', ARRAY['compras']),
  ('c_ClaveProdServ', '80181600', 'Servicios de gestión de ventas', ARRAY['ventas']),
  ('c_ClaveProdServ', '81101500', 'Ingeniería civil y arquitectura', ARRAY['ingenieria','arquitectura']),
  ('c_ClaveProdServ', '81111500', 'Diseño de software o hardware', ARRAY['software','desarrollo','programacion']),
  ('c_ClaveProdServ', '81111600', 'Programación de computadoras', ARRAY['programacion','codigo']),
  ('c_ClaveProdServ', '81111700', 'Sistemas de manejo de información', ARRAY['sistemas','ti','it']),
  ('c_ClaveProdServ', '81111800', 'Servicios de internet', ARRAY['internet','hosting']),
  ('c_ClaveProdServ', '81111900', 'Servicios de datos', ARRAY['datos','data']),
  ('c_ClaveProdServ', '81112000', 'Servicios de software', ARRAY['saas','licencia software']),
  ('c_ClaveProdServ', '81112100', 'Servicios de internet de las cosas', ARRAY['iot']),
  ('c_ClaveProdServ', '81112200', 'Mantenimiento de software', ARRAY['mantenimiento software','soporte']),
  ('c_ClaveProdServ', '81161500', 'Servicios de consultoría en tecnología', ARRAY['consultoria ti','tecnologia']),
  ('c_ClaveProdServ', '82101500', 'Publicidad impresa', ARRAY['publicidad']),
  ('c_ClaveProdServ', '82121500', 'Servicios de diseño gráfico', ARRAY['diseno','branding']),
  ('c_ClaveProdServ', '82141500', 'Servicios editoriales', ARRAY['editorial']),
  ('c_ClaveProdServ', '83101500', 'Servicios de telefonía', ARRAY['telefono','telefonia']),
  ('c_ClaveProdServ', '84111500', 'Servicios de contabilidad de costos', ARRAY['costos']),
  ('c_ClaveProdServ', '84111506', 'Servicios de facturación', ARRAY['facturacion','cfdi','timbrado']),
  ('c_ClaveProdServ', '84121500', 'Servicios bancarios', ARRAY['banco','bancario']),
  ('c_ClaveProdServ', '84121501', 'Cuentas de depósito', ARRAY['cuenta bancaria']),
  ('c_ClaveProdServ', '84121700', 'Servicios de corretaje', ARRAY['corretaje']),
  ('c_ClaveProdServ', '85101500', 'Servicios médicos', ARRAY['medico','salud']),
  ('c_ClaveProdServ', '85101600', 'Servicios dentales', ARRAY['dental','odontologia']),
  ('c_ClaveProdServ', '85101700', 'Servicios de enfermería', ARRAY['enfermeria']),
  ('c_ClaveProdServ', '85121500', 'Servicios de laboratorio médico', ARRAY['laboratorio']),
  ('c_ClaveProdServ', '85121600', 'Servicios de diagnóstico por imagen', ARRAY['rayos x','imagen']),
  ('c_ClaveProdServ', '86101500', 'Educación primaria y secundaria', ARRAY['educacion','escuela']),
  ('c_ClaveProdServ', '86101600', 'Educación universitaria', ARRAY['universidad']),
  ('c_ClaveProdServ', '86101700', 'Capacitación profesional', ARRAY['capacitacion','curso','taller']),
  ('c_ClaveProdServ', '86121500', 'Servicios de entrenamiento especializado', ARRAY['entrenamiento']),
  ('c_ClaveProdServ', '90101500', 'Restaurantes', ARRAY['restaurante','comida']),
  ('c_ClaveProdServ', '90101600', 'Cafeterías', ARRAY['cafe','cafeteria']),
  ('c_ClaveProdServ', '90101700', 'Servicios de banquetes', ARRAY['banquete','catering']),
  ('c_ClaveProdServ', '90111500', 'Hoteles y moteles', ARRAY['hotel','hospedaje']),
  ('c_ClaveProdServ', '90121500', 'Servicios de viajes', ARRAY['viaje','agencia']),
  ('c_ClaveProdServ', '91101500', 'Servicios de vigilancia', ARRAY['vigilancia','seguridad']),
  ('c_ClaveProdServ', '91111600', 'Servicios de limpieza', ARRAY['limpieza','aseo']),
  ('c_ClaveProdServ', '72101500', 'Construcción residencial', ARRAY['construccion','obra']),
  ('c_ClaveProdServ', '72101600', 'Construcción comercial', ARRAY['obra comercial']),
  ('c_ClaveProdServ', '72121500', 'Servicios de remodelación', ARRAY['remodelacion']),
  ('c_ClaveProdServ', '78101500', 'Transporte de carga por carretera', ARRAY['flete','transporte']),
  ('c_ClaveProdServ', '78101600', 'Transporte de pasajeros', ARRAY['pasajeros']),
  ('c_ClaveProdServ', '78101800', 'Servicios de mensajería', ARRAY['mensajeria','paqueteria','envio']),
  ('c_ClaveProdServ', '78121600', 'Almacenamiento', ARRAY['almacen','bodega']),
  ('c_ClaveProdServ', '50111500', 'Carne y aves de corral', ARRAY['carne']),
  ('c_ClaveProdServ', '50121500', 'Mariscos', ARRAY['mariscos','pescado']),
  ('c_ClaveProdServ', '50131700', 'Productos lácteos', ARRAY['lacteos','leche']),
  ('c_ClaveProdServ', '50181900', 'Pan y productos de panadería', ARRAY['pan','panaderia']),
  ('c_ClaveProdServ', '50201700', 'Bebidas no alcohólicas', ARRAY['refresco','agua']),
  ('c_ClaveProdServ', '50202200', 'Bebidas alcohólicas', ARRAY['alcohol','vino','cerveza']),
  ('c_ClaveProdServ', '14111500', 'Papel de impresión', ARRAY['papel']),
  ('c_ClaveProdServ', '14111507', 'Papel bond', ARRAY['bond']),
  ('c_ClaveProdServ', '43211500', 'Computadoras', ARRAY['computadora','laptop','pc']),
  ('c_ClaveProdServ', '43211600', 'Equipos de red', ARRAY['red','router','switch']),
  ('c_ClaveProdServ', '44103100', 'Tinta y tóner', ARRAY['tinta','toner']),
  ('c_ClaveProdServ', '44111500', 'Artículos de oficina', ARRAY['oficina','papeleria']),
  ('c_ClaveProdServ', '46181500', 'Equipo de seguridad', ARRAY['casco','seguridad industrial']),
  ('c_ClaveProdServ', '47121800', 'Productos de limpieza', ARRAY['detergente','jabon']),
  ('c_ClaveProdServ', '15101514', 'Gasolina regular', ARRAY['gasolina','combustible']),
  ('c_ClaveProdServ', '15101515', 'Gasolina premium', ARRAY['premium','magna']),
  ('c_ClaveProdServ', '15101505', 'Diésel', ARRAY['diesel']),
  ('c_ClaveProdServ', '84101700', 'Servicios de seguros', ARRAY['seguro','poliza']),
  ('c_ClaveProdServ', '84101701', 'Seguros de vida', ARRAY['seguro de vida']),
  ('c_ClaveProdServ', '84101703', 'Seguros de automóviles', ARRAY['seguro auto']),
  ('c_ClaveProdServ', '80111610', 'Servicios de reclutamiento', ARRAY['reclutamiento','headhunter']),
  ('c_ClaveProdServ', '80111611', 'Servicios de selección de personal', ARRAY['seleccion de personal']),
  ('c_FormaPago', '01', 'Efectivo', ARRAY['efectivo','cash']),
  ('c_FormaPago', '02', 'Cheque nominativo', ARRAY['cheque']),
  ('c_FormaPago', '03', 'Transferencia electrónica de fondos', ARRAY['transferencia','spei']),
  ('c_FormaPago', '04', 'Tarjeta de crédito', ARRAY['credito','tcredito']),
  ('c_FormaPago', '28', 'Tarjeta de débito', ARRAY['debito','tdebito']),
  ('c_FormaPago', '99', 'Por definir', ARRAY['ppd','por definir']),
  ('c_MetodoPago', 'PUE', 'Pago en una sola exhibición', ARRAY['contado','pue']),
  ('c_MetodoPago', 'PPD', 'Pago en parcialidades o diferido', ARRAY['credito','ppd','parcialidades']),
  ('c_UsoCFDI', 'G01', 'Adquisición de mercancías', ARRAY['mercancias']),
  ('c_UsoCFDI', 'G03', 'Gastos en general', ARRAY['gastos','general']),
  ('c_UsoCFDI', 'I01', 'Construcciones', ARRAY['construcciones']),
  ('c_UsoCFDI', 'D01', 'Honorarios médicos, dentales y gastos hospitalarios', ARRAY['honorarios medicos']),
  ('c_UsoCFDI', 'S01', 'Sin efectos fiscales', ARRAY['sin efectos','global']),
  ('c_RegimenFiscal', '601', 'General de Ley Personas Morales', ARRAY['moral','general']),
  ('c_RegimenFiscal', '603', 'Personas Morales con Fines no Lucrativos', ARRAY['no lucrativo']),
  ('c_RegimenFiscal', '605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios', ARRAY['sueldos','salarios']),
  ('c_RegimenFiscal', '612', 'Personas Físicas con Actividades Empresariales y Profesionales', ARRAY['actividad empresarial','pf']),
  ('c_RegimenFiscal', '616', 'Sin obligaciones fiscales', ARRAY['sin obligaciones']),
  ('c_RegimenFiscal', '626', 'Régimen Simplificado de Confianza', ARRAY['resico'])
ON CONFLICT (catalog, clave) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      synonyms = EXCLUDED.synonyms,
      active = true;
