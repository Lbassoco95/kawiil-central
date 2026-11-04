-- Marketing: registrar los agentes de Marketing en agent_registry (kind = 'system'). APLICADA en producción el 4 nov 2026 (confirmada por Dirección) como 20261104015632.
--
-- Qué hace: inserta 3 filas (Vigilante del colchón, Informe diario, Vigía del colchón) en la organización global de agentes
-- (00000000-0000-0000-0000-000000000001, la misma de los demás agentes del registro). Idempotente: si ya existen, no cambia nada.
-- Qué NO hace: no toca ninguna otra tabla, función, trabajo programado ni política; no crea tareas (agent_tasks) ni eventos;
-- no cambia marketing-colchon ni el vigía. Hasta que se confirme ese segundo paso, estas filas aparecen «sin latido» en la pestaña Agentes.
-- Sin modelo de IA (model = NULL): son trabajos programados, no agentes conversacionales. kind = 'system' los deja fuera de
-- list-agents (que solo ofrece los «consultable»), así que no salen en el selector de agentes del chat ni se instancian por cliente.
-- El Revisor no se registra: todavía no existe.
-- Reversa: tools/marketing/rollback_registrar_agentes.sql

INSERT INTO public.agent_registry (organization_id, name, display_name, description, role, status, kind, model, capabilities, config)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'marketing_vigilante', 'Vigilante del colchón',
   'Lee el calendario de Metricool por el conector de solo lectura, calcula el colchón de programación por red y mantiene un caso abierto por red mientras esté bajo la meta.',
   'marketing_vigilante', 'idle', 'system', NULL,
   '["leer_calendario_metricool","calcular_colchon","abrir_actualizar_cerrar_casos","informe_diario"]'::jsonb,
   '{"modulo":"marketing","solo_lectura":true,"trabajo":"marketing-colchon-diario-0700-cdmx","horario":"0 13 * * *","horario_legible":"todos los días 7:00 (Ciudad de México)","funcion":"marketing-colchon","objetivo":"Mantener el colchón de programación en 14 días o más en Instagram, Facebook y LinkedIn.","metas":{"colchon_verde_dias":14,"colchon_amarillo_dias":7,"caso_cerrado_al_recuperarse":true,"una_falla_abierta_como_maximo":true},"avisos":"solo panel"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'marketing_informe_diario', 'Informe diario',
   'Compara el Calendario Maestro de los próximos 14 días con lo programado en Metricool y deja el informe de faltantes, piezas con error y estados no reconocidos.',
   'marketing_informe_diario', 'idle', 'system', NULL,
   '["comparar_calendario_vs_metricool","informe_faltantes"]'::jsonb,
   '{"modulo":"marketing","solo_lectura":true,"trabajo":"marketing-colchon-diario-0700-cdmx","horario":"0 13 * * *","horario_legible":"todos los días 7:00 (Ciudad de México)","funcion":"marketing-colchon","objetivo":"Entregar cada día, antes de las 7:30, el informe de qué piezas faltan por programar.","metas":{"informe_diario_antes_de":"07:30"},"avisos":"solo panel"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'marketing_vigia', 'Vigía del colchón',
   'Revisa a las 7:30 que la corrida de las 7:00 haya quedado registrada; solo escribe (bitácora y caso de falla) cuando no la encuentra.',
   'marketing_vigia', 'idle', 'system', NULL,
   '["verificar_corrida","abrir_caso_falla_monitoreo"]'::jsonb,
   '{"modulo":"marketing","solo_lectura":true,"trabajo":"marketing-colchon-vigia-0730-cdmx","horario":"30 13 * * *","horario_legible":"todos los días 7:30 (Ciudad de México)","funcion":"mk_vigia_colchon","objetivo":"Que ninguna corrida diaria falte sin que quede un caso de falla abierto.","metas":{"corridas_faltantes":0},"avisos":"solo panel"}'::jsonb)
ON CONFLICT (organization_id, name) DO NOTHING;
