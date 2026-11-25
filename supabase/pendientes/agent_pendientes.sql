-- PENDIENTE DE CONFIRMACIÓN DE DIRECCIÓN — NO APLICADA. Vive aquí (fuera de supabase/migrations/) para que el flujo no la despliegue al fusionar.
-- Al aplicarla en producción se mueve a supabase/migrations/ con la versión real del registro de Supabase. Reversa: tools/agentes/rollback_agent_pendientes.sql.
--
-- Pendientes que un agente deja en espera (decisión de Dirección, 25 nov 2026): todo pendiente se registra con su motivo y con quién lo resuelve.
-- Criterios: trazable (cada pendiente apunta a su agente, tarea y conversación), con historial (tabla aparte que solo se agrega), y sin datos de clientes ni secretos
-- (motivo corto con un candado contra credenciales; el texto es de la VM y se limpia allá también). La escribe solo la VM (service_role); Dirección solo lee.

create table public.agent_pendientes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default '00000000-0000-0000-0000-000000000001',
  agent_id           uuid not null references public.agent_registry(id),
  task_id            uuid not null references public.agent_tasks(id),
  conversacion_id    uuid references public.agent_tasks(id),   -- solicitud original (hilo); null si ella misma es la raíz
  tipo               text not null check (tipo in ('aprobacion','captura_faltante','permiso_bloqueado','dato_faltante','autoridad','otro')),
  motivo             text not null check (char_length(btrim(motivo)) between 5 and 240),
  resuelve_tipo      text not null check (resuelve_tipo in ('persona','agente','autoridad')),
  resuelve_agente_id uuid references public.agent_registry(id),
  accion             text check (accion in ('pedirla','aprobar','pedir_ayuda','revisar')),
  estado             text not null default 'abierto' check (estado in ('abierto','cumplido','cancelado')),
  -- Requerimientos de la autoridad (origen por decidir): nunca se muestran sin folio y plazo; si no se pudieron leer, plazo_leido = false → «Sin plazo leído».
  folio              text check (folio is null or char_length(folio) <= 80),
  autoridad          text check (autoridad is null or char_length(autoridad) <= 120),
  plazo              date,
  plazo_leido        boolean,
  creado_en          timestamptz not null default now(),
  resuelto_en        timestamptz,
  resuelto_por       text check (resuelto_por is null or char_length(resuelto_por) <= 120),
  constraint pendiente_resuelve_agente check ((resuelve_tipo = 'agente') = (resuelve_agente_id is not null)),
  constraint pendiente_autoridad check (tipo <> 'autoridad' or (plazo_leido is not null and autoridad is not null)),
  constraint pendiente_plazo_leido check (plazo_leido is not true or (folio is not null and plazo is not null)),
  constraint pendiente_cierre check ((estado = 'abierto') = (resuelto_en is null)),
  -- Candado contra secretos: no es un filtro perfecto (la VM también limpia); evita lo evidente.
  constraint pendiente_sin_secretos check (motivo !~* '(contraseña|contrasena|password|passwd|token|secret|api[_ -]?key|bearer\s|op://|otp|código de verificación)')
);
create index agent_pendientes_abiertos on public.agent_pendientes (creado_en) where estado = 'abierto';
create index agent_pendientes_agente on public.agent_pendientes (agent_id, estado);
create index agent_pendientes_conversacion on public.agent_pendientes (conversacion_id);

create table public.agent_pendientes_historial (
  id            bigint generated always as identity primary key,
  pendiente_id  uuid not null references public.agent_pendientes(id),
  evento        text not null check (evento in ('creado','cumplido','cancelado','reasignado','nota')),
  por           text check (por is null or char_length(por) <= 120),
  en            timestamptz not null default now(),
  detalle       text check (detalle is null or (char_length(detalle) <= 240 and detalle !~* '(contraseña|contrasena|password|passwd|token|secret|api[_ -]?key|bearer\s|op://|otp)'))
);
create index agent_pendientes_historial_pendiente on public.agent_pendientes_historial (pendiente_id, en);

-- Historial automático y que solo se agrega: nada se edita ni se borra, ni siquiera con service_role.
create function public.agent_pendientes_registrar() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.agent_pendientes_historial (pendiente_id, evento, por) values (new.id, 'creado', 'agente');
  elsif new.estado is distinct from old.estado then
    insert into public.agent_pendientes_historial (pendiente_id, evento, por) values (new.id, new.estado, coalesce(new.resuelto_por, 'sistema'));
  elsif (new.resuelve_tipo, new.resuelve_agente_id) is distinct from (old.resuelve_tipo, old.resuelve_agente_id) then
    insert into public.agent_pendientes_historial (pendiente_id, evento, por) values (new.id, 'reasignado', 'sistema');
  end if;
  return new;
end $$;
create trigger agent_pendientes_historial_auto after insert or update on public.agent_pendientes for each row execute function public.agent_pendientes_registrar();

create function public.agent_pendientes_proteger() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'agent_pendientes_historial' then raise exception 'El historial solo se agrega: no se edita ni se borra.'; end if;
  if tg_op = 'DELETE' then raise exception 'Los pendientes no se borran: se cierran (cumplido o cancelado).'; end if;
  if (new.agent_id, new.task_id, new.conversacion_id, new.tipo, new.motivo, new.creado_en, new.organization_id)
     is distinct from (old.agent_id, old.task_id, old.conversacion_id, old.tipo, old.motivo, old.creado_en, old.organization_id) then
    raise exception 'Un pendiente no cambia de agente, tarea, tipo ni motivo: se cierra y se abre otro.';
  end if;
  if old.estado <> 'abierto' then raise exception 'Un pendiente cerrado no se reabre.'; end if;
  return new;
end $$;
create trigger agent_pendientes_proteger_upd before update or delete on public.agent_pendientes for each row execute function public.agent_pendientes_proteger();
create trigger agent_pendientes_historial_proteger before update or delete on public.agent_pendientes_historial for each row execute function public.agent_pendientes_proteger();

-- Solo Dirección lee; solo la VM (service_role) escribe.
alter table public.agent_pendientes enable row level security;
alter table public.agent_pendientes_historial enable row level security;
revoke all on public.agent_pendientes, public.agent_pendientes_historial from anon, authenticated;
grant select on public.agent_pendientes, public.agent_pendientes_historial to authenticated;
create policy agent_pendientes_lectura on public.agent_pendientes for select to authenticated using (public.is_admin_or_manager(auth.uid()));
create policy agent_pendientes_historial_lectura on public.agent_pendientes_historial for select to authenticated using (public.is_admin_or_manager(auth.uid()));
