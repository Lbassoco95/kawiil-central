-- =================================================================
-- Múuch' — semilla Anexo A (Grupo Sylon / Vizum)
-- Idempotente: no pisa series ya editadas (solo INSERT WHERE NOT EXISTS).
--
-- Clientes en prod (verificados 2026-09-17):
--   Vizum Technologies     5629ce71-0a5c-4c76-aa50-9ce22e0cf191
--   Sylon Capital          c758ce0f-63bf-4ab4-8940-d9cfe45fb762
--   Sylon Asesores         616c8dea-48a3-4a8c-b6f9-661c82875880
--
-- Rollback: migrations/2026-09-18_mtg_seed_grupo_sylon.rollback.sql
-- =================================================================

DO $$
DECLARE
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_group_id uuid := 'f1a2b3c4-d5e6-4789-a012-3456789abcde';
  v_owner_sylon uuid := 'b0ee1416-ec1e-4edf-96a5-a7f054dd1e51';
  v_owner_vizum uuid := 'e70263e1-2a64-4b07-ac58-9bd6d30f0ffa';
  v_kawiil_tenant text := 'kawiil.mx';
  v_agenda jsonb := '[
    {"key":"acuerdos_previos","title":"Acuerdos anteriores"},
    {"key":"pendientes","title":"Pendientes abiertos"},
    {"key":"vencimientos","title":"Vencimientos regulatorios y fiscales"},
    {"key":"temas_nuevos","title":"Temas nuevos del equipo"},
    {"key":"proximos_pasos","title":"Próximos pasos"}
  ]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '5629ce71-0a5c-4c76-aa50-9ce22e0cf191') THEN
    RAISE NOTICE 'mtg seed: clientes Sylon/Vizum no encontrados; omitiendo semilla';
    RETURN;
  END IF;

  INSERT INTO public.client_groups (id, organization_id, name, description, created_by)
  SELECT
    v_group_id,
    v_org,
    'Grupo Sylon',
    'Vizum Technologies + Sylon Capital + Sylon Asesores (Rivium)',
    v_owner_sylon
  WHERE NOT EXISTS (
    SELECT 1 FROM public.client_groups g
    WHERE g.organization_id = v_org AND g.name = 'Grupo Sylon'
  );

  SELECT id INTO v_group_id
  FROM public.client_groups
  WHERE organization_id = v_org AND name = 'Grupo Sylon'
  LIMIT 1;

  INSERT INTO public.client_group_members (group_id, client_id)
  SELECT v_group_id, cid
  FROM unnest(ARRAY[
    '5629ce71-0a5c-4c76-aa50-9ce22e0cf191'::uuid,
    'c758ce0f-63bf-4ab4-8940-d9cfe45fb762'::uuid,
    '616c8dea-48a3-4a8c-b6f9-661c82875880'::uuid
  ]) AS cid
  WHERE NOT EXISTS (
    SELECT 1 FROM public.client_group_members m
    WHERE m.group_id = v_group_id AND m.client_id = cid
  );

  -- Serie grupal quincenal (comité transversal)
  INSERT INTO public.mtg_series (
    id, organization_id, anchor_type, client_group_id, title, cadence,
    default_duration_min, owner_user_id, agenda_template, organizer_tenant_id, created_by
  )
  SELECT
    'a1111111-1111-4111-8111-111111111111'::uuid,
    v_org, 'group', v_group_id,
    'Comité Grupo Sylon — seguimiento transversal',
    'biweekly', 90, v_owner_sylon, v_agenda, v_kawiil_tenant, v_owner_sylon
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mtg_series s WHERE s.id = 'a1111111-1111-4111-8111-111111111111'::uuid
  );

  -- Series por cliente (semanal contable + mensual cumplimiento)
  INSERT INTO public.mtg_series (
    id, organization_id, anchor_type, client_id, title, cadence,
    default_duration_min, owner_user_id, agenda_template, organizer_tenant_id, created_by
  )
  SELECT
    v.id, v.organization_id, v.anchor_type, v.client_id, v.title, v.cadence,
    v.default_duration_min, v.owner_user_id, v.agenda_template, v.organizer_tenant_id, v.created_by
  FROM (
    VALUES
      (
        'a2222222-2222-4222-8222-222222222222'::uuid, v_org, 'client'::text,
        '5629ce71-0a5c-4c76-aa50-9ce22e0cf191'::uuid,
        'Seguimiento contable semanal — Vizum', 'weekly'::text, 60,
        v_owner_vizum, v_agenda, v_kawiil_tenant, v_owner_vizum
      ),
      (
        'a2222223-2222-4222-8222-222222222223'::uuid, v_org, 'client'::text,
        '5629ce71-0a5c-4c76-aa50-9ce22e0cf191'::uuid,
        'Comité de cumplimiento — Vizum', 'monthly'::text, 90,
        v_owner_vizum, v_agenda, v_kawiil_tenant, v_owner_vizum
      ),
      (
        'a3333333-3333-4333-8333-333333333333'::uuid, v_org, 'client'::text,
        'c758ce0f-63bf-4ab4-8940-d9cfe45fb762'::uuid,
        'Seguimiento contable semanal — Sylon Capital', 'weekly'::text, 60,
        v_owner_sylon, v_agenda, v_kawiil_tenant, v_owner_sylon
      ),
      (
        'a3333334-3333-4333-8333-333333333334'::uuid, v_org, 'client'::text,
        'c758ce0f-63bf-4ab4-8940-d9cfe45fb762'::uuid,
        'Comité de cumplimiento — Sylon Capital', 'monthly'::text, 90,
        v_owner_sylon, v_agenda, v_kawiil_tenant, v_owner_sylon
      ),
      (
        'a4444444-4444-4444-8444-444444444444'::uuid, v_org, 'client'::text,
        '616c8dea-48a3-4a8c-b6f9-661c82875880'::uuid,
        'Seguimiento contable semanal — Sylon Asesores / Rivium', 'weekly'::text, 60,
        v_owner_sylon, v_agenda, v_kawiil_tenant, v_owner_sylon
      ),
      (
        'a4444445-4444-4444-8444-444444444445'::uuid, v_org, 'client'::text,
        '616c8dea-48a3-4a8c-b6f9-661c82875880'::uuid,
        'Comité de cumplimiento — Rivium', 'monthly'::text, 90,
        v_owner_sylon, v_agenda, v_kawiil_tenant, v_owner_sylon
      )
  ) AS v(
    id, organization_id, anchor_type, client_id, title, cadence,
    default_duration_min, owner_user_id, agenda_template, organizer_tenant_id, created_by
  )
  WHERE NOT EXISTS (SELECT 1 FROM public.mtg_series s WHERE s.id = v.id);
END $$;
