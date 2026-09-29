-- =================================================================
-- Portal del cliente — M7: tickets de gasto sobre las tablas de Ju'un.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_tickets.rollback.sql
--
-- NO se crean tablas de tickets: el portal escribe en `fis_receipts` y lee
-- `fis_merchants` / `fis_cfdi` (Ju'un), en el bucket `juun` con su misma
-- convención de ruta. Así la automatización posterior (Ju'un) toma la misma
-- cola. Solo se AGREGAN policies para cuentas del portal; las existentes no
-- se tocan. La factura del ticket la genera el equipo a mano.
-- =================================================================

-- ── Ventana del comercio → fecha límite ─────────────────────────────
-- Espejo de ticketDeadline() en supabase/functions/_shared/portal/tickets.ts.
CREATE OR REPLACE FUNCTION public.portal_ticket_deadline(_merchant_id uuid, _receipt_date date)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = pg_temp, public
AS $$
  SELECT CASE
    WHEN _receipt_date IS NULL OR m.id IS NULL THEN NULL
    WHEN m.window_type = 'days' THEN
      make_timestamptz(EXTRACT(year FROM _receipt_date + m.window_days)::int,
                       EXTRACT(month FROM _receipt_date + m.window_days)::int,
                       EXTRACT(day FROM _receipt_date + m.window_days)::int, 23, 59, 59, 'America/Mexico_City')
    WHEN m.window_type = 'end_of_month' THEN
      make_timestamptz(EXTRACT(year FROM _receipt_date)::int, EXTRACT(month FROM _receipt_date)::int, 1,
                       23, 59, 59, 'America/Mexico_City') + interval '1 month' - interval '1 day'
    ELSE NULL
  END
  FROM (SELECT 1) one
  LEFT JOIN public.fis_merchants m ON m.id = _merchant_id
$$;
GRANT EXECUTE ON FUNCTION public.portal_ticket_deadline(uuid, date) TO authenticated, service_role;

-- 13 estados de Ju'un → 5 visibles para el cliente.
-- Espejo de PORTAL_TICKET_STATUS_MAP en supabase/functions/_shared/portal/tickets.ts.
CREATE OR REPLACE FUNCTION public.portal_ticket_visible_status(_status text, _expires_at timestamptz)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN _status = 'invoiced' THEN 'facturado'
    WHEN _status = 'window_expired' THEN 'vencido'
    WHEN _expires_at IS NOT NULL AND _expires_at < now() THEN 'vencido'
    WHEN _status = 'received' THEN 'recibido'
    WHEN _status IN ('extracted', 'validated', 'queued', 'processing', 'manual_queue') THEN 'en_proceso'
    WHEN _status IN ('needs_data', 'unknown_merchant', 'not_deductible', 'duplicate', 'portal_rejected') THEN 'con_problema'
    ELSE 'con_problema'
  END
$$;
GRANT EXECUTE ON FUNCTION public.portal_ticket_visible_status(text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_tickets_enabled(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT public.portal_can_read_client(_client_id) AND (
    public.portal_my_tier() = 'premier'
    OR COALESCE((SELECT s.basic_tickets_enabled FROM public.portal_client_settings s WHERE s.client_id = _client_id), false))
$$;
REVOKE ALL ON FUNCTION public.portal_tickets_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_tickets_enabled(uuid) TO authenticated;

-- ── Policies nuevas (aditivas) sobre Ju'un ──────────────────────────
DROP POLICY IF EXISTS portal_fis_receipts_select ON public.fis_receipts;
CREATE POLICY portal_fis_receipts_select ON public.fis_receipts
  FOR SELECT TO authenticated USING (public.portal_tickets_enabled(client_id));

DROP POLICY IF EXISTS portal_fis_cfdi_select ON public.fis_cfdi;
CREATE POLICY portal_fis_cfdi_select ON public.fis_cfdi
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.fis_receipts r WHERE r.id = receipt_id AND public.portal_tickets_enabled(r.client_id)));

-- Las policies existentes de fis_receipts permiten INSERT/UPDATE por organización
-- (get_user_org_id). Una cuenta del portal no tiene organización, así que no
-- pasan; aun así se bloquea explícitamente la escritura directa desde el portal.
CREATE OR REPLACE FUNCTION public.portal_block_direct_receipt_writes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.portal_is_portal_user(auth.uid())
     AND COALESCE(current_setting('portal.ticket_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El portal solo registra tickets con portal_ticket_register()' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_block_direct_receipt_writes() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_portal_block_direct_receipts ON public.fis_receipts;
CREATE TRIGGER trg_portal_block_direct_receipts BEFORE INSERT OR UPDATE OR DELETE ON public.fis_receipts
  FOR EACH ROW EXECUTE FUNCTION public.portal_block_direct_receipt_writes();

-- Storage `juun`: el portal SOLO sube la foto a
-- {org}/juun/clients/{client}/{yyyy}/{mm}/receipts/…; no lee directo (enlace firmado vía portal-api).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Portal client receipt upload') THEN
    CREATE POLICY "Portal client receipt upload" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'juun'
        AND (storage.foldername(name))[2] = 'juun'
        AND (storage.foldername(name))[3] = 'clients'
        AND (storage.foldername(name))[4] ~ '^[0-9a-f-]{36}$'
        AND (storage.foldername(name))[7] = 'receipts'
        AND public.portal_has_client_role(((storage.foldername(name))[4])::uuid, ARRAY['administrador', 'operativo'])
        AND public.portal_tickets_enabled(((storage.foldername(name))[4])::uuid)
        AND (storage.foldername(name))[1] = public.portal_client_org_id(((storage.foldername(name))[4])::uuid)::text
      );
  END IF;
END $$;

-- ── Vista de lectura (respeta la RLS de fis_receipts) ───────────────
CREATE OR REPLACE VIEW public.portal_tickets_v
WITH (security_invoker = true) AS
SELECT r.id,
       r.organization_id,
       r.client_id,
       r.merchant_id,
       COALESCE(m.name, r.extraction->>'merchant_name') AS merchant_name,
       m.window_type,
       m.window_days,
       r.receipt_date,
       r.extraction->>'folio' AS folio,
       r.total,
       r.file_path,
       r.file_hash,
       r.expires_at,
       r.status,
       public.portal_ticket_visible_status(r.status, r.expires_at) AS visible_status,
       r.extraction->>'nota_equipo' AS team_note,
       r.created_at,
       r.updated_at,
       c.uuid_fiscal AS cfdi_uuid,
       c.xml_path AS cfdi_xml_path,
       c.pdf_path AS cfdi_pdf_path
  FROM public.fis_receipts r
  LEFT JOIN public.fis_merchants m ON m.id = r.merchant_id
  LEFT JOIN LATERAL (SELECT * FROM public.fis_cfdi fc WHERE fc.receipt_id = r.id ORDER BY fc.created_at DESC LIMIT 1) c ON true;

-- ── RPC del cliente ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_ticket_register(
  _client_id uuid,
  _file_path text,
  _file_hash text,
  _merchant_id uuid DEFAULT NULL,
  _merchant_name text DEFAULT NULL,
  _receipt_date date DEFAULT NULL,
  _folio text DEFAULT NULL,
  _total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_org uuid;
  v_m public.fis_merchants;
  v_expires timestamptz;
  v_status text;
  v_id uuid;
  v_existing uuid;
  v_prefix text;
BEGIN
  IF NOT public.portal_has_client_role(_client_id, ARRAY['administrador', 'operativo'])
     OR NOT public.portal_tickets_enabled(_client_id) THEN
    RAISE EXCEPTION 'Sin permiso para subir tickets de este cliente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT organization_id INTO v_org FROM public.clients WHERE id = _client_id;
  v_prefix := v_org::text || '/juun/clients/' || _client_id::text || '/';
  IF left(_file_path, length(v_prefix)) <> v_prefix OR _file_path NOT LIKE '%/receipts/%' OR _file_path LIKE '%..%' THEN
    RAISE EXCEPTION 'Ruta de archivo fuera del cliente';
  END IF;
  IF _file_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Hash inválido (sha256 hex)'; END IF;
  IF _receipt_date IS NOT NULL AND _receipt_date > current_date + 1 THEN
    RAISE EXCEPTION 'La fecha del ticket no puede ser futura';
  END IF;

  SELECT id INTO v_existing FROM public.fis_receipts WHERE client_id = _client_id AND file_hash = _file_hash;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('receipt_id', v_existing, 'duplicate', true,
      'message', 'Este archivo ya se había subido. No se registró de nuevo.');
  END IF;

  IF _merchant_id IS NOT NULL THEN
    SELECT * INTO v_m FROM public.fis_merchants WHERE id = _merchant_id AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Comercio inválido'; END IF;
    IF v_m.window_type = 'not_applicable' THEN
      RAISE EXCEPTION 'Los tickets de % no se facturan por ticket.', v_m.name USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_expires := public.portal_ticket_deadline(_merchant_id, _receipt_date);
  v_status := CASE
    WHEN v_expires IS NOT NULL AND v_expires < now() THEN 'window_expired'
    WHEN _merchant_id IS NULL AND NULLIF(btrim(_merchant_name), '') IS NOT NULL THEN 'unknown_merchant'
    ELSE 'received' END;

  PERFORM set_config('portal.ticket_rpc', 'on', true);
  BEGIN
    INSERT INTO public.fis_receipts (organization_id, client_id, merchant_id, file_path, file_hash,
      extraction, receipt_date, total, expires_at, status, created_by)
    VALUES (v_org, _client_id, _merchant_id, _file_path, _file_hash,
      jsonb_strip_nulls(jsonb_build_object('source', 'portal_captura_manual',
        'folio', NULLIF(btrim(_folio), ''), 'merchant_name', NULLIF(btrim(_merchant_name), ''))),
      _receipt_date, _total, v_expires, v_status, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('portal.ticket_rpc', 'off', true);
    RETURN jsonb_build_object('receipt_id', NULL, 'duplicate', true,
      'message', 'Ya existe un ticket con el mismo comercio, folio y total.');
  END;
  PERFORM set_config('portal.ticket_rpc', 'off', true);

  PERFORM public.portal_audit('ticket_carga', _client_id, 'fis_receipts', v_id::text,
    jsonb_build_object('status', v_status, 'expires_at', v_expires));

  RETURN jsonb_build_object(
    'receipt_id', v_id,
    'duplicate', false,
    'status', v_status,
    'visible_status', public.portal_ticket_visible_status(v_status, v_expires),
    'expires_at', v_expires,
    'expired', v_status = 'window_expired',
    'message', CASE
      WHEN v_status = 'window_expired' THEN
        'Atención: el plazo para facturar este ticket en ' || COALESCE(v_m.name, 'el comercio') ||
        ' venció el ' || to_char(v_expires AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY') ||
        '. Lo registramos, pero probablemente ya no se pueda facturar.'
      WHEN v_expires IS NOT NULL THEN
        'Recibido. Fecha límite para facturarlo: ' || to_char(v_expires AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY') || '.'
      ELSE 'Recibido. El equipo completará los datos que falten.' END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.portal_ticket_register(uuid, text, text, uuid, text, date, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_ticket_register(uuid, text, text, uuid, text, date, text, numeric) TO authenticated;

-- ── RPC del equipo («Facturación de gastos») ────────────────────────
CREATE OR REPLACE FUNCTION public.portal_staff_ticket_queue(_include_closed boolean DEFAULT false)
RETURNS TABLE (
  id uuid, client_id uuid, client_name text, merchant_id uuid, merchant_name text, receipt_date date,
  folio text, total numeric, expires_at timestamptz, hours_left numeric, alert_24h boolean,
  status text, visible_status text, file_path text, team_note text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
  SELECT r.id, r.client_id, cl.name, r.merchant_id, COALESCE(m.name, r.extraction->>'merchant_name'),
         r.receipt_date, r.extraction->>'folio', r.total, r.expires_at,
         round((extract(epoch FROM (r.expires_at - now())) / 3600)::numeric, 1),
         (r.expires_at IS NOT NULL AND r.expires_at > now() AND r.expires_at - now() < interval '24 hours'),
         r.status, public.portal_ticket_visible_status(r.status, r.expires_at), r.file_path,
         r.extraction->>'nota_equipo', r.created_at
    FROM public.fis_receipts r
    JOIN public.clients cl ON cl.id = r.client_id
    LEFT JOIN public.fis_merchants m ON m.id = r.merchant_id
   WHERE public.portal_is_staff(auth.uid())
     AND r.organization_id = public.get_user_org_id(auth.uid())
     AND (_include_closed OR r.status NOT IN ('invoiced', 'duplicate', 'not_deductible'))
   ORDER BY r.expires_at ASC NULLS LAST, r.created_at ASC
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_ticket_update(
  _receipt_id uuid,
  _merchant_id uuid DEFAULT NULL,
  _receipt_date date DEFAULT NULL,
  _folio text DEFAULT NULL,
  _total numeric DEFAULT NULL,
  _status text DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_r public.fis_receipts; v_merchant uuid; v_date date; v_exp timestamptz;
BEGIN
  SELECT * INTO v_r FROM public.fis_receipts WHERE id = _receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT public.portal_staff_in_client_org(auth.uid(), v_r.client_id) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('received', 'processing', 'manual_queue', 'needs_data',
      'unknown_merchant', 'portal_rejected', 'window_expired', 'not_deductible', 'duplicate') THEN
    RAISE EXCEPTION 'Estado inválido (para «facturado» use portal_staff_ticket_mark_invoiced)';
  END IF;
  v_merchant := COALESCE(_merchant_id, v_r.merchant_id);
  v_date := COALESCE(_receipt_date, v_r.receipt_date);
  v_exp := COALESCE(public.portal_ticket_deadline(v_merchant, v_date), v_r.expires_at);
  UPDATE public.fis_receipts SET
    merchant_id = v_merchant,
    receipt_date = v_date,
    total = COALESCE(_total, total),
    expires_at = v_exp,
    status = COALESCE(_status, CASE WHEN status = 'unknown_merchant' AND _merchant_id IS NOT NULL THEN 'received' ELSE status END),
    extraction = COALESCE(extraction, '{}'::jsonb)
      || CASE WHEN _folio IS NOT NULL THEN jsonb_build_object('folio', btrim(_folio)) ELSE '{}'::jsonb END
      || CASE WHEN _note IS NOT NULL THEN jsonb_build_object('nota_equipo', left(_note, 500)) ELSE '{}'::jsonb END
  WHERE id = _receipt_id;
  PERFORM public.portal_audit('ticket_estado', v_r.client_id, 'fis_receipts', _receipt_id::text,
    jsonb_build_object('antes', v_r.status, 'despues', COALESCE(_status, v_r.status)));
  IF _status IN ('needs_data', 'portal_rejected', 'unknown_merchant', 'not_deductible') THEN
    PERFORM public.portal_enqueue('correo', 'ticket_con_problema', v_r.client_id, jsonb_build_object(
      'receipt_id', _receipt_id, 'note', _note, 'to', to_jsonb(public.portal_client_admin_emails(v_r.client_id))));
  END IF;
END;
$$;

-- Al facturar, el equipo adjunta XML y PDF (ya subidos al bucket juun por portal-api).
CREATE OR REPLACE FUNCTION public.portal_staff_ticket_mark_invoiced(
  _receipt_id uuid, _uuid text, _xml_path text, _pdf_path text,
  _total numeric, _rfc_emisor text, _rfc_receptor text, _issue_date timestamptz
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_r public.fis_receipts; v_cfdi uuid; v_rfcs text[];
BEGIN
  SELECT * INTO v_r FROM public.fis_receipts WHERE id = _receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.portal_staff_in_client_org(auth.uid(), v_r.client_id) OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _xml_path IS NULL OR _pdf_path IS NULL THEN RAISE EXCEPTION 'Se requieren XML y PDF'; END IF;
  SELECT array_agg(DISTINCT upper(x)) INTO v_rfcs FROM (
    SELECT rfc AS x FROM public.clients WHERE id = v_r.client_id AND rfc IS NOT NULL
    UNION ALL SELECT rfc FROM public.fis_tax_profiles WHERE client_id = v_r.client_id AND active) s;
  IF NOT (upper(COALESCE(_rfc_receptor, '')) = ANY (COALESCE(v_rfcs, '{}'))) THEN
    RAISE EXCEPTION 'El RFC receptor del XML (%) no es del cliente', _rfc_receptor;
  END IF;
  INSERT INTO public.fis_cfdi (organization_id, receipt_id, uuid_fiscal, xml_path, pdf_path, total, issue_date, rfc_emisor, rfc_receptor)
  VALUES (v_r.organization_id, _receipt_id, upper(_uuid), _xml_path, _pdf_path, _total, _issue_date, upper(_rfc_emisor), upper(_rfc_receptor))
  RETURNING id INTO v_cfdi;
  UPDATE public.fis_receipts SET status = 'invoiced' WHERE id = _receipt_id;
  PERFORM public.portal_audit('ticket_facturado', v_r.client_id, 'fis_receipts', _receipt_id::text,
    jsonb_build_object('uuid', upper(_uuid)));
  PERFORM public.portal_enqueue('correo', 'ticket_facturado', v_r.client_id, jsonb_build_object(
    'receipt_id', _receipt_id, 'uuid', upper(_uuid), 'to', to_jsonb(public.portal_client_admin_emails(v_r.client_id))));
  RETURN v_cfdi;
END;
$$;

-- Catálogo de ventanas editable (solo campos de ventana; la receta es de Ju'un).
CREATE OR REPLACE FUNCTION public.portal_staff_merchant_update_window(_merchant_id uuid, _window_type text, _window_days int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  IF NOT public.portal_is_staff_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo G3/G4' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.fis_merchants
     SET window_type = _window_type,
         window_days = CASE WHEN _window_type = 'days' THEN _window_days ELSE NULL END
   WHERE id = _merchant_id;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_staff_ticket_queue(boolean)',
    'portal_staff_ticket_update(uuid, uuid, date, text, numeric, text, text)',
    'portal_staff_ticket_mark_invoiced(uuid, text, text, text, numeric, text, text, timestamptz)',
    'portal_staff_merchant_update_window(uuid, text, int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ── Invocación de las Edge del portal por cron ──────────────────────
-- Se crea la función pero NO se programa el cron: se activa a mano (RUNBOOK §4)
-- cuando portal-notify y portal-dropbox-sync estén desplegadas y configuradas.
CREATE OR REPLACE FUNCTION public.invoke_portal_edge_cron(_function text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_secret text;
BEGIN
  IF _function NOT IN ('portal-notify', 'portal-dropbox-sync') THEN
    RAISE EXCEPTION 'Función no permitida';
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'portal cron: cron_secret no está en vault';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/' || _function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_portal_edge_cron(text) FROM PUBLIC, anon, authenticated;
