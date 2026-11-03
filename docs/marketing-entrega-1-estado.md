# Marketing · Entrega 1 — Estado al 31 oct 2026

Objetivo: lista para revisión el **10 nov**. Decisiones de Dirección aplicadas: gris 30/90 min, semana sin piezas = gris, escalamiento con dos lecturas definitivas, pieza en la semana de su primera publicación real en cualquier red.

## Hecho
- **Migración** `supabase/migrations/20261031120000_marketing_modulo_base.sql` (aún **no aplicada** a Supabase; solo escrita y probada en un Postgres 16 local con tablas de apoyo simuladas):
  - Tablas `mk_*`: pieza, pieza por red, resultado (por corte y por fuente), seguidores por semana, reglas + historial, casos, propuestas, decisiones, experimentos, bitácora y calibración.
  - Etapa (1–6) y propósito en la pieza; las etapas 2–6 no requieren tablas nuevas.
  - Bitácora, historial de reglas y decisiones son solo-inserción (probado: UPDATE/DELETE fallan).
  - Cambiar una regla y decidir una propuesta solo se puede con `mk_cambiar_regla` / `mk_decidir_propuesta`, que exigen el permiso `marketing_decidir` y motivo, y dejan historial y bitácora. Probado: sin permiso falla, sin motivo falla, con permiso crea la versión 2 con usuario.
  - Quien solo tiene `marketing` ve todo y no puede escribir; quien no tiene ninguno no ve nada. Probado.
  - Las 13 reglas v1 (incluidas gris 30/90, frecuencia 15/60 y la regla de semana y fecha de corte) se siembran con `mk_sembrar_reglas_v1(org)`, idempotente.
  - `mk_semaforo_semana`: promedio simple sin redondear; «desde N» incluye N; sin piezas publicadas → gris. Probado en bordes: 35 verde, 34.99 amarillo, 14.99 rojo, pieza con error no cuenta.
  - Regla de corte: pieza en domingo 23:30 en Instagram y lunes en LinkedIn queda en **una sola semana** (la de su primera publicación). Probado.
- **Permisos**: claves `marketing` y `marketing_decidir` agregadas a `src/hooks/useModulePermissions.ts`. No se agregó ruta ni sidebar todavía (entrega 2). `tsc` no se corrió: no hay `node_modules` en este entorno.

## Bloqueado
- **Calendario Maestro** (`Calendario_Maestro_Kawiil_Nov2026_Ene2027.xlsx`): no está en el repositorio ni apareció en Google Drive ni en Dropbox. Dirección dejó pendiente indicar cómo lo entrega. **No se empezó la carga del historial ni la calibración**, como se instruyó.
- Por eso todavía no hay: piezas cargadas contra esperadas, número de piezas tras agrupar 44/47/48, caso 1 con evidencia, ni tabla de calibración.

## Siguiente, cuando llegue el archivo
1. Aplicar la migración y sembrar reglas v1 para la organización de Kawiil.
2. Cargar las publicaciones de «Datos Metricool» y «Datos FB y LinkedIn», agruparlas por pieza y reportar piezas vs. esperadas por red, y las que no cuadren (con criterio de agrupación explícito).
3. Cargar resultados con `fuente = calendario_maestro` y, solo lectura de Metricool mediante, `fuente = metricool` en la entrega 2. Si Metricool solo da acumulado, se informa la diferencia por semana y red; no se corrige.
4. Cargar caso 1 con la evidencia de los datos (5 piezas fallidas: 22, 23, 24, 26 y 29 de septiembre; 11 días sin posts en el feed; caída de alcance desde el 17 de septiembre).
5. Llenar `mk_calibracion` y devolver la tabla semana por semana y red por red.

## Pendiente de Dirección
Indicar cómo se entrega el archivo; responsable humano y respaldo; confirmar fórmula del semáforo; base del umbral de Instagram; confirmar agentes nuevos.
