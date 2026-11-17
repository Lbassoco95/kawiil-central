-- Puente notifications → Web Push (PWA) + avisos nuevos para candidatos y avisos del equipo.
--
-- Todo es ADITIVO: no se modifica ninguna tabla, trigger ni función existente.
-- Cada función nueva atrapa sus propios errores para que NUNCA bloquee el INSERT original
-- (alta de candidato, publicación de aviso, solicitud de ausencia, etc.).
--
-- Tipos de notificación que se envían al celular (allowlist):
--   rh_request_pending   solicitud de ausencia/vacaciones por aprobar (ya existía en notifications)
--   rh_request_decided   solicitud aprobada/rechazada                  (ya existía)
--   rh_candidate_new     candidato nuevo en una vacante                (NUEVO en esta migración)
--   aviso_equipo         aviso publicado para el equipo                (NUEVO en esta migración)
--   email_new            correo nuevo en una cuenta conectada          (lo inserta push-email-poller)
-- Slack (DM y menciones) NO entra aquí: slack-events ya manda su propio push.
--
-- Rollback:
--   drop trigger if exists trg_push_bridge_notification on public.notifications;
--   drop trigger if exists trg_rh_candidate_notify_new on public.rh_candidates;
--   drop trigger if exists trg_aviso_equipo_notify on public.aviso_equipo;
--   select cron.unschedule('push-email-poller');

-- 1) Estado del poller de correo (solo service_role; RLS activa y sin políticas)
create table if not exists public.email_push_state (
  account_key text primary key,
  user_id uuid not null,
  last_checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_push_state enable row level security;
comment on table public.email_push_state is
  'Marca de agua por cuenta de correo para push-email-poller (qué correos ya se avisaron). Solo service_role.';

-- 2) Puente: cada notificación de los tipos permitidos dispara la edge function push-from-notification
create or replace function public.push_bridge_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'pipeline_cron_secret'
     limit 1;
  exception when others then
    v_secret := null;
  end;

  if v_secret is null or btrim(v_secret) = '' then
    begin
      v_secret := current_setting('app.pipeline_cron_secret', true);
    exception when others then
      v_secret := null;
    end;
  end if;

  if v_secret is null or btrim(v_secret) = '' then
    raise notice 'push_bridge_notification: pipeline_cron_secret no configurado';
    return new;
  end if;

  perform net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/push-from-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object(
      'notification_id', new.id,
      'user_id', new.user_id,
      'type', new.type,
      'title', new.title,
      'body', new.body,
      'entity_type', new.entity_type,
      'entity_id', new.entity_id
    )
  );
  return new;
exception when others then
  raise warning 'push_bridge_notification: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.push_bridge_notification() from public, anon, authenticated;

drop trigger if exists trg_push_bridge_notification on public.notifications;
create trigger trg_push_bridge_notification
  after insert on public.notifications
  for each row
  when (new.type in ('rh_request_pending', 'rh_request_decided', 'rh_candidate_new', 'aviso_equipo', 'email_new'))
  execute function public.push_bridge_notification();

-- 3) Candidato nuevo → avisa a los responsables de la vacante (o a los G4 si no tiene responsables)
create or replace function public.rh_candidate_notify_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
begin
  select title into v_title from public.rh_recruitment_processes where id = new.process_id;

  v_body := coalesce(nullif(btrim(new.full_name), ''), 'Una persona')
            || case when v_title is not null then ' · ' || v_title else '' end
            || case when nullif(btrim(coalesce(new.source, '')), '') is not null then ' (' || btrim(new.source) || ')' else '' end;

  insert into public.notifications
    (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
  select distinct r.uid, new.organization_id, 'rh_candidate_new', 'Candidato nuevo', v_body, 'rh', new.id, false, new.created_by
  from (
    select o.user_id as uid
      from public.rh_process_owners o
     where o.process_id = new.process_id
    union
    select ur.user_id
      from public.user_roles ur
      join public.profiles p on p.user_id = ur.user_id and p.organization_id = new.organization_id
     where ur.role = 'transformador'
       and not exists (select 1 from public.rh_process_owners o2 where o2.process_id = new.process_id)
  ) r
  where r.uid is distinct from new.created_by;

  return new;
exception when others then
  raise warning 'rh_candidate_notify_new: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.rh_candidate_notify_new() from public, anon, authenticated;

drop trigger if exists trg_rh_candidate_notify_new on public.rh_candidates;
create trigger trg_rh_candidate_notify_new
  after insert on public.rh_candidates
  for each row
  execute function public.rh_candidate_notify_new();

-- 4) Aviso publicado para el equipo → notificación a toda la organización (menos quien lo aprobó)
create or replace function public.aviso_equipo_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado is distinct from 'publicado' then
    return new;
  end if;
  -- Anidado a propósito: en un INSERT, `old` no existe y no debe evaluarse.
  if tg_op = 'UPDATE' then
    if old.estado is not distinct from 'publicado' then
      return new;
    end if;
  end if;

  insert into public.notifications
    (user_id, organization_id, type, title, body, entity_type, entity_id, is_read, source_user_id)
  select p.user_id, new.organization_id, 'aviso_equipo',
         coalesce(nullif(btrim(new.titulo), ''), 'Aviso del equipo'),
         left(coalesce(new.mensaje, ''), 240),
         'aviso', new.id, false, new.aprobado_por
    from public.profiles p
   where p.organization_id = new.organization_id
     and coalesce(p.is_active, true) is true
     and p.user_id is distinct from new.aprobado_por;

  return new;
exception when others then
  raise warning 'aviso_equipo_notify: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.aviso_equipo_notify() from public, anon, authenticated;

drop trigger if exists trg_aviso_equipo_notify on public.aviso_equipo;
create trigger trg_aviso_equipo_notify
  after insert or update of estado on public.aviso_equipo
  for each row
  execute function public.aviso_equipo_notify();

-- 5) Cron del poller de correo (cada 5 min), mismo patrón y secreto que el resto de crons
create or replace function public.invoke_push_email_poller_cron()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'pipeline_cron_secret'
     limit 1;
  exception when others then
    v_secret := null;
  end;

  if v_secret is null or btrim(v_secret) = '' then
    begin
      v_secret := current_setting('app.pipeline_cron_secret', true);
    exception when others then
      v_secret := null;
    end;
  end if;

  if v_secret is null or btrim(v_secret) = '' then
    raise notice 'push-email-poller cron: pipeline_cron_secret no configurado (vault o GUC)';
    return;
  end if;

  perform net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/push-email-poller',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_push_email_poller_cron() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-email-poller') then
    perform cron.unschedule('push-email-poller');
  end if;
  perform cron.schedule('push-email-poller', '*/5 * * * *', 'select public.invoke_push_email_poller_cron()');
end;
$$;
