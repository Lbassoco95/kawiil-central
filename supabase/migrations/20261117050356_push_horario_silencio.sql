-- Horario de silencio de los avisos al celular (hora de Ciudad de México). Aditivo e idempotente.
-- Por defecto: de 22:00 a 07:00. Cada persona puede cambiarlo o apagarlo en Notificaciones.
-- Durante el silencio no se manda push; la notificación sigue guardándose en la campana.
alter table public.profiles
  add column if not exists push_quiet_enabled boolean not null default true,
  add column if not exists push_quiet_start time not null default '22:00',
  add column if not exists push_quiet_end time not null default '07:00';

comment on column public.profiles.push_quiet_enabled is 'Si es true, no se mandan avisos push entre push_quiet_start y push_quiet_end (hora de Ciudad de México).';
comment on column public.profiles.push_quiet_start is 'Inicio del horario de silencio de los avisos push (hora de Ciudad de México).';
comment on column public.profiles.push_quiet_end is 'Fin del horario de silencio de los avisos push (hora de Ciudad de México).';
