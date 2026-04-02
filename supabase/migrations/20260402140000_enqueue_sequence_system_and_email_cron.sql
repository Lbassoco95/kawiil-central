-- Cancelar cola de secuencia desde Edge (service_role); cancel_sequence_emails usa JWT de usuario.
CREATE OR REPLACE FUNCTION public.cancel_sequence_emails_system(
  p_organization_id uuid,
  p_lead_id uuid,
  p_sequence_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN 0;
  END IF;

  UPDATE public.email_log el
  SET status = 'cancelled'
  WHERE el.organization_id = p_organization_id
    AND el.lead_id = p_lead_id
    AND el.status = 'queued'
    AND (
      p_sequence_id IS NULL
      OR el.sequence_step_id IN (
        SELECT id FROM public.email_sequence_steps WHERE sequence_id = p_sequence_id
      )
    );

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sequence_emails_system(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_sequence_emails_system(uuid, uuid, uuid) TO service_role;

-- RPC para Edge (service_role): encolar secuencia sin JWT de usuario.
CREATE OR REPLACE FUNCTION public.enqueue_sequence_system(
  p_organization_id uuid,
  p_lead_id uuid,
  p_sequence_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_cum_delay numeric := 0;
  v_sched timestamptz;
  v_tpl record;
  v_subj text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id AND l.organization_id = p_organization_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.email_sequences s
    WHERE s.id = p_sequence_id
      AND s.organization_id = p_organization_id
      AND s.is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sequence_not_found');
  END IF;

  PERFORM public.cancel_sequence_emails_system(p_organization_id, p_lead_id, p_sequence_id);

  FOR v_rec IN
    SELECT ess.id AS step_id, ess.delay_hours, ess.template_id, ess.step_order
    FROM public.email_sequence_steps ess
    WHERE ess.sequence_id = p_sequence_id
    ORDER BY ess.step_order ASC
  LOOP
    v_cum_delay := v_cum_delay + COALESCE(v_rec.delay_hours, 0);
    v_sched := now() + make_interval(hours => v_cum_delay::integer);

    SELECT t.subject, t.name INTO v_tpl
    FROM public.email_templates t
    WHERE t.id = v_rec.template_id
      AND t.organization_id = p_organization_id
      AND t.is_active;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_subj := COALESCE(v_tpl.subject, v_tpl.name);

    INSERT INTO public.email_log (
      organization_id, lead_id, template_id, sequence_step_id, to_email, subject, status, scheduled_at
    )
    SELECT
      p_organization_id,
      p_lead_id,
      v_rec.template_id,
      v_rec.step_id,
      l.email,
      v_subj,
      'queued',
      v_sched
    FROM public.leads l
    WHERE l.id = p_lead_id
      AND l.email IS NOT NULL
      AND btrim(l.email) <> '';
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_sequence_system(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_sequence_system(uuid, uuid, uuid) TO service_role;

-- Cola de emails: invocar Edge process-email-queue cada 15 min.
-- Configurar el mismo valor que CRON_SECRET (Secrets del proyecto Edge):
--   ALTER DATABASE postgres SET app.pipeline_cron_secret = '...';
CREATE OR REPLACE FUNCTION public.invoke_process_email_queue_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  v_secret := NULL;
  BEGIN
    v_secret := current_setting('app.pipeline_cron_secret', true);
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'process-email-queue cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_email_queue_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_process_email_queue_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'pipeline-process-email-queue'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'pipeline-process-email-queue',
  '*/15 * * * *',
  $$SELECT public.invoke_process_email_queue_cron()$$
);
