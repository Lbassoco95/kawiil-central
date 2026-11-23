# Donna: seguimiento proactivo (plan de trabajo)

Objetivo (Louis, nov 2026): que el sistema **dé el seguimiento solo**, no que espere a que se le pregunte.
Que mantenga Kawiil Central al día, detecte lo que ya se resolvió sin marcarse, vigile fechas y aprenda de lo que se trabaja y se cierra.

## 1. Dónde estamos hoy (lo que ya existe)

| Pieza | Qué hace | Límite |
|---|---|---|
| `kawiilito-cierre` (cron 17:00 lun-vie) | Avisa de tareas que vencen hoy o vencidas y compromisos de juntas sin tarea | Solo mira tareas; mensaje fijo, sin IA |
| `ai-proactive-notifications` (cron) | Avisos con IA (Haiku) | No revisa actividades ni cruza fuentes |
| `push-email-poller` + horario de silencio | Aviso al celular de correos | Solo correo |
| `agente-seguimiento` / `agent_memories` | Seguimiento de tareas **de los agentes** y su memoria | No sigue **tu** trabajo ni el de las actividades |
| Cerebro (agenda, plazos, memoria) | Agenda y plazos en Cowork | Vive aparte; `agenda_vs_tablero` compara, pero solo si alguien lo corre |

**Hueco principal:** nada compara por sí solo lo que pasó en mensajes, juntas y correo contra lo que dice Kawiil Central. Por eso "ya se resolvió pero no se marcó" no se detecta, y las actividades (p. ej. Navidad Kawiil) no tienen quien las vigile.

## 2. Fases

### Fase 0: Radar de actividades (reglas, sin IA) · primero
Un cron diario (mismo patrón que `kawiilito-cierre`) revisa cada actividad activa y avisa solo lo que requiere acción:
- Faltan días para el evento y falta sede, hora o presupuesto.
- Invitados sin responder pasados N días (con botón para reenviar su enlace).
- Solicitudes de +1 por aprobar.
- Proveedores sin confirmar o con anticipo pendiente.
- Tareas de la actividad vencidas.

Resumen agrupado en "ahora / esta semana / más adelante" (dirección Zen + Glass), por push y en el Dashboard. Barato y confiable: es la base de las demás fases.

### Fase 1: "Ya se resolvió pero no está marcado"
Donna lee las fuentes a las que ya tiene acceso (Slack, correo, minutas de juntas, calendario) y, por cada tarea abierta, busca evidencia de cierre.
- **Escalera de autonomía:** (a) *propone* el cierre con la evidencia citada y tú confirmas con un toque; (b) pasado un tiempo con buena precisión, cierra sola lo de bajo riesgo y deja **deshacer**; (c) lo que toque dinero, clientes o trámites regulatorios **siempre** pide confirmación.
- Cada cierre dice de dónde salió (mensaje, junta, correo).

### Fase 2: Aprender de lo que cierras
- Guardar cada propuesta con su resultado (aceptada / rechazada / corregida).
- Convertir lo aprendido en memorias del agente, respetando el contrato `enabled` de `docs/agentes-memoria-vm-contrato.md` (lo que Dirección apaga no se vuelve a aprender).
- Medir precisión cada semana; si baja de un umbral, vuelve a "solo proponer".
- Revisión semanal: qué se cerró, qué avanzó, qué se estancó.

### Fase 3: Radar de fechas único
Una sola vista de fechas con recordatorios escalonados (7 · 3 · 1 días y el mismo día): tareas, actividades, juntas, plazos legales/regulatorios (Cerebro `plazos_vigentes`) y compromisos de minutas. Nada de fechas "solo en la agenda de Cowork".

### Fase 4: Cómputo NVIDIA / deep learning
Aclaración honesta: **las fases 0 a 3 no necesitan GPU**; funcionan con el modelo alojado que ya usamos. La GPU se justifica cuando haya una razón concreta:
1. **Privacidad:** correr un modelo abierto en casa (vLLM / NVIDIA NIM) para leer datos de clientes sin salir de nuestra infraestructura.
2. **Costo/volumen:** embeddings y reordenamiento de miles de documentos, mensajes y correos a diario.
3. **Modelo propio:** entrenar o afinar un clasificador ("¿esto cierra aquella tarea?") con los datos etiquetados que genera la Fase 2.

Pasos previos: (i) acumular 4 a 6 semanas de aceptadas/rechazadas de la Fase 2; (ii) medir cuánto cuesta y tarda hoy; (iii) decidir equipo local (p. ej. estación con GPU junto a la VM `kawiil-agents`) o GPU en la nube; (iv) piloto con un solo flujo (clasificar cierres) y comparar contra el modelo alojado. Solo se invierte si gana en privacidad, costo o precisión.

## 3. Reglas de seguridad y calma
- Solo lectura sobre las fuentes; las escrituras en Kawiil Central van por funciones con permisos y quedan en bitácora.
- Respetar el horario de silencio (22:00–07:00) y agrupar avisos: pocos, claros, sin alarma.
- Sin contenido de clientes en logs; evidencia como referencia (enlace/fecha), no copia.
- Toda acción automática se puede deshacer y se ve en un registro.

## 4. Decisiones que necesitamos de Louis
1. ¿Empezamos por la **Fase 0** (radar de actividades)? Es lo más rápido de ver funcionando.
2. Nivel de autonomía inicial: ¿solo proponer cierres, o cerrar solo lo de bajo riesgo desde el inicio?
3. ¿Qué fuentes entran primero: Slack, juntas, correo, calendario?
4. NVIDIA: ¿el motivo principal es privacidad, costo o precisión? Define si hay que adelantar la Fase 4.
5. Hora del resumen diario (hoy el cierre es 17:00; ¿agregamos uno de mañana?).
