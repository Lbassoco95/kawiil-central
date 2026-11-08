# Constructor de agentes (módulo Agentes)

Pestañas nuevas en `/agentes` (solo Dirección, mismo permiso `admin` estricto del módulo):

- **Crear agente**: chat especializado (`supabase/functions/agente-constructor`, acción `chat`). Hace las preguntas que faltan (rol, cliente, fuentes, informes, límites) y entrega una *propuesta* estructurada. Nada se crea hasta pulsar «Crear agente» (acción `crear`).
- **Instrucciones**: elegir un agente y mandarle una tarea por el despacho existente (`dispatch-to-agent` → VM `kawiil-agents`).
- Oficina: filtro nuevo **Mi equipo** (agentes con `config.origen = 'constructor_agentes'`).

## Qué escribe «crear»
Una fila en `agent_registry` (`kind='consultable'`, `status='idle'`, org global) con la misma forma que los agentes existentes: `config.system_prompt`, `tono`, `entregables`, `limites`, más `fuentes`, `cadencia`, `cliente`, `mision`, `creado_por`. El prompt lo arma el servidor (`_shared/agenteConstructor.ts`) con reglas fijas (solo lectura, borradores, sin secretos, escalar dudas legales); el modelo del chat no escribe nada. Sin migraciones ni cambios de RLS.

## Pendiente / a confirmar
- La VM `kawiil-agents` debe leer `config.system_prompt` (así lo hacen los agentes sembrados) y respetar `config.fuentes`/`cadencia`; declarar una fuente **no** da acceso por sí sola. Verificarlo en el repo `kawiil-agents`.
- Despliegue: `deploy-supabase.yml` publica la función al fusionar a `main` (no entre 6:30 y 7:00 CDMX). Requiere `ANTHROPIC_API_KEY` (ya usado por otras funciones).
- Siguientes pasos naturales: editar instrucciones permanentes de un agente ya creado, informes programados por agente y coordinación entre agentes del equipo Vizum.
