-- Fase 1 de seguridad: cerrar lo que el rol `anon` (clave pública) no debe poder hacer.
-- Idempotente: se puede ejecutar más de una vez.
--
-- 1) Políticas de escritura abiertas a cualquiera (`TO public ... true`).
-- 2) Funciones SECURITY DEFINER ejecutables por `anon` vía /rest/v1/rpc.
-- 3) Privilegios de escritura de `anon` sobre tablas (defensa en profundidad).
--
-- Lo que NO toca (decisión pendiente): lectura pública de agent_registry,
-- agent_tasks y agent_activity_logs, y las funciones usadas por políticas que
-- aplican a anon (get_user_org_id, is_admin_or_manager,
-- can_edit_org_permission_settings).

-- ── 1) Políticas «Service …» que en realidad eran para todo el mundo ─────────
-- service_role omite RLS, así que estas políticas solo servían a anon/authenticated.
-- El frontend solo lee knowledge_insights y actualiza su propio feed
-- ("Users update own feed"); los inserts/updates los hace knowledge-sync con service role.
DROP POLICY IF EXISTS "Service insert insights" ON public.knowledge_insights;
DROP POLICY IF EXISTS "Service update insights" ON public.knowledge_insights;
DROP POLICY IF EXISTS "Service insert feed" ON public.knowledge_feed;

-- ── 2) Funciones SECURITY DEFINER ────────────────────────────────────────────
DO $$
DECLARE
  r record;
  -- Solo las llama service_role / cron (postgres): ni anon ni authenticated.
  service_only text[] := ARRAY[
    'invoke_ai_proactive_notifications_cron','invoke_cert_expiry_notifier_cron',
    'invoke_job_queue_cron','invoke_moffin_monthly_sat_cron',
    'invoke_moffin_refresh_pending_cron','invoke_notification_digest_cron',
    'invoke_process_email_queue_cron','invoke_process_scheduled_mail_cron',
    'invoke_refresh_weekday_phrases_cron','invoke_reminder_hourly_digest_cron',
    'invoke_satgo_facturas_cron','invoke_satgo_monthly_cron',
    'invoke_slack_jornada_sync_cron','invoke_sync_inbox_emails_cron',
    'invoke_travel_refresh_cron',
    'create_scheduled_recurring_tasks','rh_absence_daily_digest',
    'rh_force_close_jornadas','rh_recruit_stale_digest',
    'claim_jobs','complete_job','fail_job','get_edge_fn_source',
    'cancel_sequence_emails_system','enqueue_sequence_system',
    'pipeline_calendly_apply_system'
  ];
  -- Deben seguir siendo accesibles a anon:
  --  · contract_client_*: portal público del cliente (autenticado por token).
  --  · helpers que usan políticas aplicables a anon (revisar antes de cerrar).
  keep_anon text[] := ARRAY[
    'contract_client_get','contract_client_patch',
    'get_user_org_id','is_admin_or_manager','can_edit_org_permission_settings'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'execute')
  LOOP
    IF r.proname = ANY (keep_anon) THEN
      CONTINUE;
    ELSIF r.proname = ANY (service_only) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END IF;
  END LOOP;
END
$$;

-- Funciones nuevas: no ejecutables por anon/PUBLIC salvo que se otorgue expresamente.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ── 3) anon no escribe en ninguna tabla ──────────────────────────────────────
-- Las políticas ya lo impiden; esto lo hace imposible aunque una política se
-- configure mal. Los formularios públicos pasan por Edge Functions (service role).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
