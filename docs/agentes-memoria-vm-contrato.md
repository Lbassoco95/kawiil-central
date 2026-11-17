# Contrato de la VM `kawiil-agents` con la memoria de los agentes (`agent_memories`)

**Para:** quien mantiene `kawiil-agents` (FastAPI en la Mac de Leo, `supabase-py`, llave de servicio propia `kawiil-agents-mac`).
**Por qué:** la pestaña **Agentes → Memoria** (PR #560) deja a Dirección **apagar** una memoria (`enabled = false`) sin ver su texto. Eso solo sirve si la VM **respeta** `enabled`. Desde el repositorio no se puede comprobar: la VM lee y escribe `agent_memories` directamente (no hay función, trigger ni vista en la base que filtre). **Estado a 16-nov-2026: NO verificado.** Este documento dice qué debe cumplir la VM y cómo demostrarlo.

## 1. Lo que la VM debe cumplir al LEER memorias
Aplica a **todos** los caminos que arman el contexto de un agente: tareas manuales, tareas programadas, hilos de conversación («seguimiento dentro de un hilo») y cualquier futura delegación entre agentes.

1. **Solo memorias activas:** `enabled = true`. Una fila con `enabled` falso o nulo **no entra** al contexto del agente (la columna es `NULL`able con valor por defecto `true`; tratar `NULL` como no activa).
2. **Solo memorias vigentes:** `expires_at IS NULL OR expires_at > now()`.
3. **Acotada al agente y a la organización:** `agent_id = <agente de la tarea>` y `organization_id = '00000000-0000-0000-0000-000000000001'`.
4. **Nada de caché que sobreviva al cambio:** si la VM guarda memorias en memoria del proceso, el filtro se aplica **al armar cada tarea** (o la caché dura como máximo 60 segundos). Una memoria apagada no puede seguir usándose «hasta reiniciar».
5. **`access_count` y `last_accessed_at` solo de las memorias que de verdad se inyectaron.** Una memoria apagada **nunca** debe aumentar su `access_count` (así se demuestra que no se leyó; ver sección 4).
6. **Sin contenido en los registros:** el texto de una memoria no va a `agent_activity_logs`, a `ai_task_events` ni a ningún log de la VM (puede traer datos de clientes). Registrar solo `id`, tipo y cuántas se usaron.

Referencia en Python (`supabase-py`), a adaptar al código real:

```python
ahora = datetime.now(timezone.utc).isoformat()
filas = (
    supabase.table("agent_memories")
    .select("id, memory_type, category, content, importance")        # nunca select("*") sin necesidad
    .eq("organization_id", ORG_AGENTES)
    .eq("agent_id", agent_id)
    .eq("enabled", True)                                              # NULL y False quedan fuera
    .or_(f"expires_at.is.null,expires_at.gt.{ahora}")
    .order("importance", desc=True)
    .limit(MAX_MEMORIAS_POR_TAREA)
    .execute()
    .data
)
# solo después de elegir cuáles se inyectan:
for m in filas: marcar_uso(m["id"])   # access_count + 1, last_accessed_at = ahora
```

## 2. Lo que la VM debe cumplir al ESCRIBIR memorias
1. Las memorias nuevas nacen con `enabled = true` (el valor por defecto) y con `source_task_id` de la tarea que las originó (hoy 79 de 79 lo tienen).
2. **Nunca reactivar ni cambiar `enabled`** de una fila existente: esa decisión es solo de Dirección, por la función `agente-memoria`.
3. **No volver a aprender lo que una persona apagó:** antes de insertar una memoria, comparar con las del mismo agente **incluidas las apagadas**; si ya existe una equivalente apagada, **no insertarla otra vez**. Si no, apagar una memoria mala no sirve de nada: el agente la aprende de nuevo como fila nueva.
4. No guardar contraseñas, claves ni datos que no hagan falta; si el texto parece un secreto, no se guarda.

## 3. Lo que NO cambia
- Quién puede apagar o encender: solo Dirección, desde la pantalla (función `agente-memoria`, `verify_jwt`, `is_admin_or_manager`). La VM no necesita ese permiso.
- La pantalla nunca muestra el texto de una memoria; solo tipo, categoría corta, importancia, uso y vencimiento.

## 4. Cómo demostrar que se cumple (criterio de aceptación)
**A. Revisión de código (sin riesgo):** en `kawiil-agents`, todo `select` sobre `agent_memories` para armar contexto incluye `enabled = true` y la vigencia (puntos 1 y 2 de la sección 1). Anotar archivo y línea en el PR de la VM.

**B. Prueba real (con confirmación de Dirección, un agente de prueba):**
1. Elegir un agente de prueba y **una** memoria suya de poca importancia. Anotar su `id` y su `access_count` (consulta 1 de `tools/agentes/verificar_memoria_enabled.sql`).
2. En **Agentes → Memoria**, apagar esa memoria.
3. Mandarle al agente de prueba una tarea inocua que use su memoria (por ejemplo, desde la barra «¿Qué necesitas?»).
4. Cuando la tarea termine, repetir la consulta: **el `access_count` de la memoria apagada no debe haber cambiado** y las demás memorias activas del agente sí deben mostrar uso (consulta 2).
5. Volver a **encender** la memoria desde la pantalla y repetir el paso 3: ahora su `access_count` debe subir.
6. Resultado esperado: apagada → no se lee; encendida → se lee. Si la memoria apagada sigue subiendo, la VM no respeta `enabled`: corregir la sección 1 y repetir.

**C. Vigilancia continua:** la consulta 3 del archivo SQL cuenta memorias apagadas que se leyeron **después** de apagarse (`last_accessed_at > updated_at`). Debe dar **0**; cualquier otro valor es una alarma.

## 5. Reversa
Si algo sale mal, **encender** de nuevo la memoria desde la pantalla (o `enabled = true` por la función). No se borra ni se edita nada.

## 6. Estado actual (para referencia)
- **Resultado de la prueba B (17-nov-2026): la VM respeta `enabled` al leer** en tareas manuales. Detalle en la sección 7.
- 80 memorias de 21 agentes al 16-nov (antes de la prueba); 0 con `enabled` nulo; 0 vencidas activas. Al terminar la prueba, Coyolli quedó con 11 memorias, todas activas.
- Pendiente: los otros caminos (tareas programadas, hilos, otros agentes) y la regla de no volver a aprender lo apagado (secciones 1 y 2); ver la sección 8.

## 7. Resultado de la prueba real (agente de prueba: Coyolli, 17-nov-2026, hora UTC)
**Por qué Coyolli y por qué es una prueba válida.** Es un agente de consulta sin accesos, fuentes ni escrituras configurados. En producción, el `access_count` de cada memoria coincide con las tareas completadas desde que se creó: **cada tarea completada lee todas las memorias activas del agente**. Por eso, si la VM ignorara `enabled`, la memoria apagada habría subido junto con las demás.

**Procedimiento.** Memoria elegida: `65582416-2d05-4e05-ad48-c27d2e2d41ed` (tipo dato, importancia 0.4, nunca usada). Tarea inocua enviada a Coyolli desde la barra de tareas: responder una palabra, sin consultar sitios ni documentos.

| Paso | Hora | `65582416…` | Las otras 8 activas |
|---|---|---|---|
| Estado base | 00:07 | encendida, 0 usos | 8, 7, 6, 5, 4, 3, 2, 1 usos |
| Se apaga la memoria (vía el mismo cambio de `enabled` y `updated_at` que hace la pantalla) | 00:15 | **apagada**, 0 usos | sin cambio |
| Tarea 1 (terminó 00:18, 8 s, sin error) | 00:18 | **0 usos, nunca leída** | **+1 cada una** (9, 8, 7, 6, 5, 4, 3, 2) |
| Se vuelve a encender | 00:30 | encendida, 0 usos | sin cambio |
| Tarea 2 (terminó 00:32, 9 s, sin error) | 00:32 | **1 uso** | **+1 cada una** (10 … 3) |

**Conclusión.** Apagada, la memoria no se leyó, aunque se apagó 3 minutos antes de la tarea (se descarta una caché larga); encendida, sí se leyó. Quedó probado el control positivo y el negativo. Efecto secundario normal: tras cada tarea la VM creó una memoria nueva para el agente (activa, con 0 usos al crearse).

## 8. Lo que la prueba NO cubre
- **Un solo agente y tareas manuales.** Faltan las tareas programadas, los hilos de conversación («seguimiento dentro de un hilo») y otros agentes; si la VM tiene un camino distinto para armar contexto, debe usar el mismo filtro (sección 1).
- **No volver a aprender lo apagado (sección 2, punto 3):** sin probar. Hoy, si la VM aprende lo mismo otra vez, lo guarda como fila nueva y activa.
- **Vigencia (`expires_at`):** sin probar (no hay memorias vencidas activas).
- **Caja negra:** el código de la VM no se pudo revisar desde el repositorio; la revisión de código (A) sigue pendiente con quien la mantiene.
- La consulta de vigilancia continua (3 de `tools/agentes/verificar_memoria_enabled.sql`) sigue dando 0 y debe seguir así.
