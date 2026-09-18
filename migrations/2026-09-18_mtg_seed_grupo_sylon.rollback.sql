-- Rollback: supabase/migrations/20260918120300_mtg_seed_grupo_sylon.sql
DELETE FROM public.mtg_series
 WHERE id IN (
   'a1111111-1111-4111-8111-111111111111',
   'a2222222-2222-4222-8222-222222222222',
   'a2222223-2222-4222-8222-222222222223',
   'a3333333-3333-4333-8333-333333333333',
   'a3333334-3333-4333-8333-333333333334',
   'a4444444-4444-4444-8444-444444444444',
   'a4444445-4444-4444-8444-444444444445'
 );

DELETE FROM public.client_group_members m
 USING public.client_groups g
 WHERE m.group_id = g.id AND g.name = 'Grupo Sylon';

DELETE FROM public.client_groups WHERE name = 'Grupo Sylon';
