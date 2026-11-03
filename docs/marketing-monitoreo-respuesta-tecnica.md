# Marketing · Módulo de Monitoreo — Respuesta técnica (sección 10)

Fecha: 31 oct 2026 · Responde a: determinación funcional de Polo (Dirección General) · Estado: propuesta para visto bueno.
Alcance: solo etapa 1 (monitoreo de campañas). Lo marcado **[verificar]** no se pudo confirmar desde el repo y debe validarse antes de comprometer fecha.

## Lo que ya existe en Kawiil Central y se reutiliza

| Necesidad | Lo que hay hoy | Dónde |
|---|---|---|
| Registrar un módulo y limitar roles | `user_module_permissions` (por usuario, `enabled`), `ModuleGate`, `MODULE_KEYS`, `AppSidebar` | `src/hooks/useModulePermissions.ts`, `src/components/ModuleGate.tsx`, `src/components/AppSidebar.tsx` |
| Revisión periódica | pg_cron + `net.http_post` a una Edge Function con `x-cron-secret` | patrón de `supabase/migrations/20261021180000_kawiilito_cierre_cron.sql` |
| Cola de trabajos con reintentos | `claim_jobs` + `job-queue-dispatch` | `supabase/functions/job-queue-dispatch` |
| Agentes con IA | `agent_registry`, `dispatch-to-agent` (proxy a la VM `kawiil-agents`), `list-agents` | `supabase/functions/dispatch-to-agent`, `nexo-louis/kawiil-agents` |
| Avisos dentro de la app | tabla/UI de notificaciones | `src/pages/Notificaciones.tsx` |
| Metricool | **Nada.** No hay integración ni mención en ninguno de los dos repos | — |

## 1. ¿Se puede obtener de Metricool el estado y resultados de forma automática?

**Probablemente sí, con condiciones [verificar].** Metricool ofrece API pública con token de usuario (listado de publicaciones programadas/publicadas con estado y analítica por red). Hay que confirmar tres cosas antes de construir:

1. Que el **plan contratado incluya acceso a la API** (históricamente es de planes superiores).
2. Que el estado por red devuelva el **motivo del error** (el requisito pide «mensaje de error»), y que distinga «Con errores» de «pendiente que no salió».
3. Qué **límites de consultas** tiene y qué retraso tienen las métricas de alcance (afecta los cortes de 48 h y 7 d).

Alternativas si no se cumple, de mejor a peor:
- **A. Exportación programada de Metricool (CSV/informe) subida a Storage.** Costo bajo, pero la detección sería diaria, no en 60 min → no cumple el criterio 1. Riesgo: depende de una persona.
- **B. APIs nativas de Meta y LinkedIn.** Cumple tiempos, pero implica revisión de app en Meta/LinkedIn y tokens por cuenta. Costo y plazo altos (semanas de aprobación). Solo para estado de publicación, no para sustituir toda la analítica.
- **C. Captura manual desde el Calendario Maestro.** Solo como respaldo; el módulo debe permitir cargar resultados a mano de todos modos.

Recomendación: confirmar el plan de Metricool esta semana; si hay API, ir con ella; si no, A para resultados y B solo para estado de publicación.

## 2. Frecuencia del Vigilante

Propuesta: **cada 15 minutos dentro de ventana de publicación** (desde 15 min antes de cada hora programada hasta 90 min después) y **cada hora fuera de ella**. Resultados (48 h y 7 d) y semáforo: una vez al día. Conexión de cuentas: lunes, más una verificación cada vez que falle un sondeo.

Con eso la regla de 30 min se evalúa en el primer ciclo posterior al minuto 30, y el caso queda visible a lo sumo ~45 min después de la hora programada → **cumple el criterio de 60 min con margen de 15**. Si Metricool limita consultas, se sube a 30 min y el criterio quedaría justo en el límite (60 min); en ese caso conviene que Dirección acepte 75 min o que se pida más cuota.

El Vigilante es **código determinista** (Edge Function + cron), no un LLM: las reglas 1–7 son umbrales y conteos. Esto lo hace barato, auditable y reproducible. El LLM se usa solo en el Revisor.

## 3. Registro en Kawiil Central y roles

- Nueva clave de módulo `marketing` en `MODULE_KEYS` / `MODULE_LABELS`, ruta `/marketing` con `ModuleGate`, entrada en el sidebar. Subrutas: `panel`, `calendario`, `casos`, `propuestas`, `bitacora`, `aprendizaje`, `reglas`, `experimentos`.
- **Brecha:** `user_module_permissions` solo distingue «ve / no ve». El requisito exige que *decidir* (aprobar, rechazar, cambiar reglas) sea de Dirección. Propuesta: segunda clave `marketing_decidir`, con RLS que impide aprobar o editar reglas sin ella. Ver ≠ decidir.
- Todas las tablas nuevas con prefijo `mk_` y RLS por organización, igual que el resto.
- Para quedar listo para las etapas 2–6 no se crean tablas por etapa: cada pieza lleva `etapa` (1–6) y `proposito` (conectar/enseñar/vender), y las métricas son genéricas por «elemento» y red.

Modelo de datos mínimo (resumen):
`mk_pieza` (programada, pilar, formato, etapa, propósito, tema, enlace al copy) · `mk_pieza_red` (hora real, estado, error, por red) · `mk_resultado` (48 h / 7 d: alcance o impresiones, guardados, compartidos, clics, reacciones, comentarios) · `mk_seguidores_semana` · `mk_caso` · `mk_propuesta` · `mk_decision` · `mk_regla` + `mk_regla_historial` · `mk_experimento` · `mk_bitacora`.
Nota: una «pieza» sale en tres redes, así que el historial de 44 + 47 + 48 publicaciones **no son 139 piezas**; hay que cruzar por pieza al importar.

## 4. Conexión con Cerebro

Estoy de acuerdo con la propuesta de Cowork: **resumen semanal como memoria, no como aviso.** Una Edge Function semanal arma el resumen (semáforo por red, casos abiertos/cerrados, propuestas decididas, cambios de regla, experimentos) y lo deja en Cerebro. Louis lo lee con `memoria_leer`/`cerebro_estado`. **[verificar]** que Cerebro exponga una vía de *escritura* de memoria para este caso; las herramientas visibles hoy son de lectura y de entregables. Si no la hay, se registra como entregable semanal con `entregable_registrar`.
Para que Louis nunca vea un estado viejo como actual, el resumen lleva fecha de corte.

## 5. Estimado por etapas (esfuerzo de ingeniería, orden de magnitud)

| Bloque | Incluye | Estimado |
|---|---|---|
| Base | migraciones `mk_*`, RLS, módulo y roles, carga del historial 30 jul–30 oct, caso 1 con evidencia | 4–6 días |
| Ingesta Metricool | conector, mapeo de estados, reintentos, cortes 48 h/7 d (si hay API) | 4–6 días |
| Vigilante | reglas 1–4 y 7, semáforo, casos, bitácora | 5–7 días |
| Pantallas v1 | panel del día, calendario, casos, propuestas con botones, bitácora, reglas con historial | 8–12 días |
| Revisor | guía de 7 pasos con registro de cada paso, propuesta y cambio de monitoreo | 5–7 días |
| Aprendizaje + resumen a Cerebro | cortes por pilar/formato/horario/red/etapa, evolución semanal | 4–6 días |

**Primera versión (≈6–8 semanas con una persona):** todo lo anterior salvo lo de abajo. **Después:** experimentos con medición de resultado (v1 solo registra el experimento), regla 8 (revisiones de nov/dic/ene, mientras tanto manual), recálculo automático de umbrales, aviso por correo/Slack, etapas 2–6. Los tiempos dependen del punto 1; si no hay API de Metricool, súmense 2–4 semanas.

## 6. Dudas y riesgos que veo en la determinación

1. **El semáforo no está definido con precisión** (y el criterio 2 exige que coincida con el Calendario Maestro): ¿semana de lunes a domingo? ¿Se agrupa por fecha de publicación? ¿El alcance usado es el de 48 h o el de 7 d? Una pieza de la semana en curso aún no tiene 7 d. Instagram y Facebook miden *alcance*, LinkedIn *impresiones*: no son comparables. Necesito la fórmula exacta de la hoja «Monitoreo».
2. **Umbrales con huecos:** el promedio semanal es decimal y los rangos son enteros (Instagram «34» amarillo y «35» verde: ¿qué pasa con 34.6?). Definir redondeo.
3. **El umbral verde de Instagram sale de la media (35) pero la mediana es 15.** La diferencia indica pocas piezas muy altas (p. ej. el pico del 16 de sep) que suben la media. Con mediana 15, una semana «normal» puede quedar en amarillo o rojo con frecuencia y generar casos que no son problema. Además dice «26 piezas» mientras el historial de Instagram es de 44 posts: aclarar cuáles se excluyeron. Esta es decisión de Dirección (pendiente «confirmar umbrales»).
4. **Regla 1 vs. criterio 1:** la regla dice «caso el mismo día», el criterio dice «visible en 60 minutos». Propongo que prevalezca el criterio (más estricto) y la regla 1 se lea «a los 30 min se marca la pieza; el caso se abre en el siguiente ciclo».
5. **«No publican, no borran, no reprograman» se cumple por diseño de código, no por permisos.** El token de Metricool normalmente da acceso completo a la cuenta. Mitigación: el conector solo implementa lecturas, el token vive solo en secretos de Edge Function, y toda llamada queda en la bitácora. Dirección debe saber que la garantía es de software, no de la plataforma.
6. **Un solo punto de falla:** si el Vigilante o el token de Metricool caen, no hay caso y todo parece verde, que es justo lo que pasó con los 11 días en septiembre. Propongo una regla 0 «el Vigilante no ha sondeado en N minutos» visible en el panel (estado gris, no verde).
7. **Hipótesis del caso 1:** parte de la investigación (estado de la cuenta de Instagram, algoritmo) no se ve por API. El Revisor documentará «no verificable» en vez de inferir.
8. **Zona horaria:** usar America/Mexico_City en todo. El cron existente usa UTC-6 fijo, coherente porque México ya no tiene horario de verano.
9. **Responsable humano y respaldo**: sin ellos, nadie decide y los casos se acumulan en «Dirección». Es pendiente de Polo y bloquea el criterio 4.
10. **Agentes existentes:** el registro actual tiene agentes de la VM `kawiil-agents`. Propongo crear Vigilante y Revisor como entradas nuevas en `agent_registry` en lugar de reutilizar uno con otro rol, para que la bitácora y los permisos queden limpios.

## Decisiones que necesito de Polo antes de empezar

1. Plan de Metricool: ¿incluye API? (lo confirma quien administra la cuenta).
2. Fórmula exacta del semáforo (punto 6.1) y redondeo (6.2).
3. Responsable humano del módulo y respaldo.
4. ¿Vigilante y Revisor nuevos (recomendado) o reutilizar agentes existentes?
5. ¿Se acepta que el criterio de 60 min dependa de sondeo cada 15 min?
