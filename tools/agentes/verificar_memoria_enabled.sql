-- Solo LECTURA. Verifica que la VM `kawiil-agents` respete `agent_memories.enabled` (ver docs/agentes-memoria-vm-contrato.md, sección 4).
-- No selecciona `content` ni `source_description`: el texto de las memorias no se lee.
-- Reemplaza :agente por el nombre del agente de prueba y :memoria por el id de la memoria que se apagó.

-- 1) Antes y después de la prueba: uso de las memorias del agente de prueba (anota access_count de la memoria apagada).
select m.id, m.memory_type, m.category, m.importance, m.enabled, m.access_count, m.last_accessed_at, m.updated_at
from agent_memories m join agent_registry r on r.id = m.agent_id
where r.name = :'agente'
order by m.importance desc, m.created_at desc;

-- 2) Tras la tarea de prueba: la memoria apagada NO debe haber cambiado su access_count; las activas del agente sí deben mostrar uso reciente.
select m.id, m.enabled, m.access_count, m.last_accessed_at,
       (m.last_accessed_at > now() - interval '30 minutes') as leida_en_los_ultimos_30_min
from agent_memories m
where m.id = :'memoria'
   or (m.agent_id = (select agent_id from agent_memories where id = :'memoria') and m.enabled)
order by m.enabled, m.access_count desc;

-- 3) Vigilancia continua: memorias APAGADAS que se leyeron después de apagarse. Debe dar 0.
select count(*) as apagadas_leidas_despues_de_apagarse
from agent_memories
where enabled is not true and last_accessed_at is not null and last_accessed_at > updated_at;

-- 4) Estado general (sanidad).
select count(*) filter (where enabled) as activas, count(*) filter (where enabled is not true) as apagadas_o_nulas,
       count(*) filter (where enabled and expires_at is not null and expires_at < now()) as vencidas_activas, count(*) as total
from agent_memories;
