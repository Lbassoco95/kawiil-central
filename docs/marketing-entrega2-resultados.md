# Marketing · Entrega 2 — resultados de Metricool, detección de publicaciones y semáforo con datos de la semana

Estado: **diseño para revisión de Dirección (2 nov 2026). Nada implementado ni escrito en producción.**
Todo es solo lectura de Metricool, por la lista cerrada de rutas, a través del conector `marketing-metricool` ya desplegado.

## 1. Lo que ya existe y se reutiliza (verificado en producción)
- `mk_resultado`: cortes `48h`, `7d`, `acumulado`; fuentes `metricool` y `calendario_maestro`; medidas `alcance` e `impresiones`; única por `(pieza_red_id, corte, fuente)`; columnas `valor`, `guardados`, `compartidos`, `clics`, `reacciones`, `comentarios`, `extra jsonb`. Hoy solo tiene filas del archivo (`acumulado`, `calendario_maestro`): 47 Facebook, 26 Instagram y 48 LinkedIn; guardados vacíos; compartidos solo Facebook y LinkedIn.
- `mk_pieza_red`: `estado` (`pendiente`/`publicada`/`con_errores`), `publicada_at`, `mensaje_error`, `metricool_id`. Un disparador recalcula `primera_publicacion_at` (semana de la pieza).
- `mk_calibracion`: semáforo semanal por red (columnas calculadas y columnas del archivo para contrastar).
- `mk_cobertura_fuente`: qué rango cubre cada fuente por red. `mk_semaforo_semana(org, semana, red, fuente='metricool')`: promedio simple por pieza con la regla vigente.
- Reglas v1 ya aprobadas: `publicacion` (30 min), `errores`, `huecos` (3 días), `dato_sospechoso` (48 h), `estado_gris` (30/90 min), `ventana_publicacion` (15 min dentro de la ventana, cada hora fuera), `escalamiento`, `semaforo_*`.
- Tipos de caso ya admitidos: `publicacion`, `error`, `hueco`, `dato_sospechoso`, `falla_monitoreo`.

## 2. Rutas (todas ya en la lista cerrada; no se añade ninguna)
| Ruta (GET) | Para qué | Estado |
|---|---|---|
| `/v2/scheduler/posts` | estado por red de cada publicación (programada, publicada, con error) | probada |
| `/v2/scheduler/posts/{uuid}/events` | motivo del error de una publicación (solo si falló) | por probar |
| `/v2/analytics/posts/instagram` (`from`, `to`, `timezone`) | alcance, guardados, compartidos y demás de cada publicación | por probar |
| `/stats/facebook/posts`, `/stats/linkedin/posts` | métricas de Facebook y LinkedIn | **el swagger no documenta sus parámetros**; se sondean primero |
| `/v2/analytics/timelines` | seguidores por semana | por probar |
| `/v2/settings/users/{userId}/api-usage-stats` | consumo de la API (medir límites antes de subir la frecuencia) | por probar |

Alternativa si los `/stats/...` fallan: `/v2/analytics/posts/facebook|linkedin` (devuelven CSV); requiere que Dirección apruebe agregarlas.

## 3. Qué métrica es cada cosa (según los esquemas del swagger)
| Dato | Instagram | Facebook | LinkedIn |
|---|---|---|---|
| Medida del semáforo (`valor`) | `reach` (alcance) | `impressionsUnique` (alcance; **por validar contra el archivo**) | `impressions` (impresiones) |
| Guardados | `saved` | **no existe en la API** | **no existe en la API** |
| Compartidos | `shares` | `shares` | `shares` |
| Reacciones / comentarios / clics | `likes` / `comments` / `clicks` | `reactions` / `comments` / `clicks` | `likes` / `comments` / `clicks` |
| Va a `extra` | tipo, hora de publicación, edad en horas, interacciones, engagement, seguidores ganados, vistas | tipo, impresiones totales y orgánicas, engagement, vistas de video | tipo, impresiones únicas, engagement, vistas de video |

Guardados solo se puede medir en Instagram: en Facebook y LinkedIn la columna queda vacía (no es un error de carga).

## 4. Qué se guarda y qué nunca
Se guarda: red, identificador de la publicación en Metricool, fecha y hora, tipo/formato, métricas numéricas y la edad de la pieza al momento de leer.
**No se guarda nunca**: texto o descripción de la publicación, título, hashtags, etiquetas, enlaces a imágenes, nombres o correos de quien la creó, ubicación, ni nada de terceros. La reducción ocurre en memoria, antes de escribir (misma técnica que `extraerPublicaciones` del colchón); una prueba verifica que ningún campo de texto llega a la base.

## 5. Cortes de 48 horas y 7 días
Metricool devuelve el valor acumulado **al momento de la lectura**; no guarda el valor «a las 48 h». Por eso:
- Se lee dos veces al día (7:10 y 19:10, hora de Ciudad de México). La primera lectura en que una pieza ya tiene ≥48 h fija su corte `48h`; la primera con ≥168 h fija su corte `7d`. Cada corte se escribe una sola vez y guarda `edad_horas` real (con dos lecturas diarias, el corte queda entre 48 y 60 h).
- Entre cortes se mantiene una fila `acumulado` (fuente `metricool`) con la última lectura, para el semáforo provisional de la semana en curso. Solo para piezas de los últimos 14 días.
- LinkedIn puede tardar 1–2 días en completar sus métricas: su corte de 48 h puede salir bajo; se marca en `extra` y el semáforo usa el de 7 días.
- Las piezas históricas (30 jul–30 oct) no tienen corte de 7 días real: se cargan como `acumulado` con la fecha de captura (mismo carácter que los valores del archivo).

## 6. Frecuencia
| Qué | Cuándo | Llamadas aprox. |
|---|---|---|
| Estado de publicación y errores (`scheduler/posts`) | cada 15 min dentro de la ventana de publicación del día (30 min antes de la primera pieza a 90 min después de la última) y cada hora fuera de ella, como dice la regla `ventana_publicacion` | ~66 al día |
| Resultados (3 rutas de analítica) | 7:10 y 19:10 | 6 al día |
| Seguidores (`timelines`) | lunes 7:20 | 3 por semana |
| Consumo de la API | diario 7:25 | 1 al día |
Cada llamada queda en `mk_api_log`. Se mide `api-usage-stats` antes de activar los 15 minutos; si el límite aprieta, se baja a cada hora sin cambiar el diseño.

## 7. Detección de piezas que no salieron o salieron con error
Cada pieza esperada (calendario) se cruza con Metricool por red, fecha y hora (±30 min):
- Programada y ya pasó su hora + 30 min sin publicarse → caso `publicacion` (uno por pieza, con las redes afectadas).
- Con error → `mk_pieza_red.estado = con_errores`, `mensaje_error` con el motivo (ruta de eventos) y caso `error` inmediato.
- Publicada → `estado = publicada`, `publicada_at`, `metricool_id`.
- No aparece en Metricool y ya pasó su hora → caso `publicacion` («no encontrada»).
- Un solo caso abierto por pieza y tipo; se cierra solo cuando se resuelve (misma mecánica que el colchón). Las fallas de lectura usan el caso `falla_monitoreo` ya existente.
- Resultado cero a las 48 h → caso `dato_sospechoso` (regla vigente).

## 8. Semáforo semanal recalculado
- Función nueva `mk_recalcular_semaforo(semana)` (solo service_role): escribe `mk_calibracion` con la fuente `metricool` donde `mk_cobertura_fuente` la cubre; conserva las columnas del archivo para contrastar.
- **Defecto a corregir en `mk_semaforo_semana`**: si una pieza tiene `7d` y `acumulado`, hoy cuenta dos veces. La versión nueva toma por pieza `7d` si existe y, si no, `acumulado`; y marca la semana «provisional» mientras haya piezas con menos de 7 días o sin corte de 7 días.
- Se recalcula tras la lectura de las 7:10 (semana en curso y anterior).
- Escalamiento (regla vigente): una semana en rojo provisional se señala; dos definitivas seguidas abren caso para el Revisor.

## 9. Carga histórica (30 jul – 30 oct) y contraste con el archivo
Orden, cada paso con su confirmación:
1. **Sondeo** (solo lectura): una llamada a cada ruta nueva para ver la forma real de la respuesta y los parámetros de Facebook y LinkedIn.
2. **Simulacro**: la función lee todo el periodo y **no escribe datos**; devuelve el reporte de contraste.
3. **Revisión de Dirección** del reporte.
4. **Carga** de `mk_resultado` (fuente `metricool`, corte `acumulado`), filas de `mk_pieza_red` para publicaciones de Instagram anteriores al 8 de septiembre que correspondan a una pieza del calendario de esa misma fecha (se vinculan por fecha; si hay duda no se crea nada y se reporta) y filas de `mk_cobertura_fuente`.
5. **Recalcular el semáforo** del periodo y **propuesta de umbrales de Instagram** con las 44 publicaciones (mismo método de la v1: media y mediana). Cambiar la regla va por `mk_cambiar_regla`, con motivo y confirmación de Dirección.

Contraste, por semana y por red:
| Columna | Qué muestra |
|---|---|
| piezas archivo / piezas API / emparejadas | emparejadas por red + fecha (+ hora si la hay); sin pareja de cada lado, listadas |
| promedio archivo vs promedio API | y diferencia en % |
| color archivo vs color API | con la regla vigente |
| piezas con diferencia | API menor que archivo (imposible en un acumulado: dato a revisar) o diferencia mayor a 25 % |
Criterio para cargar: todas las piezas del archivo emparejadas o explicadas, y los colores semanales iguales salvo diferencias explicadas. Prudencia metodológica: los valores de la API se leen semanas después de publicar y tenderán a ser algo mayores que los del archivo; el contraste mide esa deriva y no la oculta.

## 10. Escrituras en producción previstas (cada una por separado, con su confirmación)
1. Sondeo: ~5 invocaciones del conector (solo agrega filas a `mk_api_log`).
2. Migración: `mk_semaforo_semana` corregida y `mk_recalcular_semaforo` (solo funciones).
3. Despliegue de la función de resultados, en modo simulacro.
4. Ejecución del simulacro (sin datos, solo `mk_api_log`).
5. Carga histórica de datos (tras aprobar el contraste).
6. Recalcular el semáforo histórico y cobertura de Metricool.
7. Despliegue del Vigilante de publicación y sus trabajos programados (con el vigía y el aviso de falla ya existentes).
8. Cambio de umbrales de Instagram (`mk_cambiar_regla`) y la nota del umbral, si Dirección lo decide.

## 11. Riesgos
- Parámetros de Facebook y LinkedIn sin documentar (por eso el sondeo primero).
- Instagram no devuelve publicaciones marcadas como sensibles, restringidas por país ni colaboraciones de otra cuenta: pueden faltar piezas.
- LinkedIn: las métricas por publicación de perfiles personales solo existen para lo publicado desde Metricool; si la cuenta es una página de empresa no aplica. Por confirmar.
- Alcance de Facebook: Metricool lo reporta distinto de la plataforma con el tiempo; se valida contra el archivo antes de fijarlo como medida.
- Límites de la API sin documentar: se miden antes de subir la frecuencia.
