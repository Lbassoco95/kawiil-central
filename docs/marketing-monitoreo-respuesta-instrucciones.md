# Marketing · Primera versión — Respuesta a las instrucciones de Dirección (sección 5)

Fecha: 31 oct 2026 · Complementa `marketing-monitoreo-respuesta-tecnica.md`.

## 1. Calendario por entrega

Hoy es sábado 31 de octubre. Las fechas suponen que Dirección revisa cada entrega en 2 días hábiles y que los insumos de la sección 4 llegan antes del lunes 2 de noviembre.

| Entrega | Lista para revisión | Notas |
|---|---|---|
| 1 — Base e historial | **martes 10 nov** | Incluye la calibración del semáforo (sección 3 de las instrucciones), porque necesita el historial cargado. |
| 2 — Metricool y Vigilante | **martes 24 nov** | Deja 6 días de margen antes del 30 nov y tiempo para la prueba con una pieza real programada. |
| 3 — Semáforo y aprendizaje | martes 8 dic | |
| 4 — Revisor y propuestas | martes 22 dic | |
| 5 — Experimentos y resumen a Cerebro | jueves 8 ene | Antes de la revisión del 14 ene. |

**El objetivo del 30 de noviembre (entregas 1 y 2) es viable**, con una condición: que la API de Metricool devuelva lo necesario (ver punto 2). Si la entrega 2 se atora por eso, el riesgo es la prueba real, no el panel. La revisión del 31 de diciembre quedaría con las entregas 1 a 3.

## 2. Límites de consulta de Metricool

**No lo sé todavía.** Busqué documentación pública de límites y no encontré nada de Metricool; no voy a poner una cifra inventada. Se resuelve de dos formas, y pido ambas:
- Quien administra la cuenta de Metricool revisa el plan contratado y la documentación de la API (o pregunta a su soporte): límite por minuto/día, y si el listado de publicaciones y las métricas se piden por separado.
- En la entrega 2, el primer paso es medirlo: se hacen consultas de prueba y se reporta lo observado.

Efecto previsto en los 15 minutos: el diseño usa **una consulta de listado por red por ciclo** y las métricas solo una vez al día (y en los cortes de 48 h y 7 d). Con una ventana de publicación de 12 horas serían unas 48 consultas por red en la ventana más 12 fuera de ella, es decir **unas 180 consultas al día entre tres redes** en total. Si el límite del plan es menor, el Vigilante consulta solo las redes con piezas próximas y se le avisa a Dirección; la frecuencia no se baja en silencio.

## 3. Dudas sobre la sección 2 (decisiones)

1. **Contradicción entre las decisiones 2 y 3.** Fuera de la ventana el Vigilante consulta cada hora, pero la decisión 3 pone la red en gris si pasaron más de 30 minutos sin consulta exitosa. De noche todo se vería gris y habría un caso de falla de monitoreo cada día. Propongo: umbral de 30 min **dentro** de la ventana y 90 min **fuera** de ella (una consulta horaria fallida más margen). Necesito confirmación.
2. **Semáforo y piezas sin publicar.** La fórmula promedia «por pieza publicada». Una pieza que falló no tiene alcance y no cuenta. Si todas las piezas de una semana fallan, no hay promedio: propongo mostrar gris «sin piezas publicadas» y no rojo, y que el caso lo abra la regla de errores/huecos. Confirmar.
3. **Escalamiento con lectura provisional.** «Dos semanas seguidas en rojo» abre caso para el Revisor. La lectura definitiva llega hasta 7 días después de la última pieza, o sea cerca de una semana tarde. Propongo: la señal del Vigilante (una semana en rojo) usa la provisional y se marca como tal; el caso al Revisor solo se abre con lecturas definitivas. Confirmar.
4. **Alcance «a 7 días» en el historial.** Metricool normalmente entrega el acumulado a la fecha de consulta, no el valor exacto a los 7 días. Para piezas ya publicadas, el valor cargado puede ser mayor al que tenía el Calendario Maestro. La calibración lo cuantificará; hacia adelante, el Vigilante guarda una foto con fecha y hora en los 48 h y 7 d para tener el valor real, y registra el retraso si un ciclo se perdió.
5. **Piezas en semanas distintas por red.** Cada pieza cuenta en la semana de su publicación real y por red. Una pieza que salga en domingo en una red y en lunes en otra contará en semanas distintas en cada una. Es coherente con la fórmula, pero conviene que Dirección lo sepa.
6. **Solo lectura demostrable (decisión 4).** Propuesta técnica: una única Edge Function guarda el token de Metricool en secretos del servidor y solo implementa consultas de lectura con lista cerrada de rutas; ni la interfaz ni los agentes tienen el token ni llaman a Metricool (el Revisor lee del propio módulo). Cada llamada se registra (ruta, método, resultado), y una prueba automática falla si alguna llamada saliente no es de lectura. Dos reservas: algunas APIs usan POST para consultas de lectura; si pasa, se permite solo esa ruta concreta y queda documentado. Y el token **no está en el repositorio ni lo voy a pedir por este canal**: lo carga quien administra el proyecto directamente en los secretos de Supabase.
7. **Cerebro (decisión 7).** Existe la herramienta de registrar entregables en Cerebro, así que el resumen del lunes como entregable es viable. Falta confirmar cómo se autentica una Edge Function contra Cerebro, y que el cliente «Kawiil MX» exista ahí. Se resuelve en la entrega 5, no bloquea antes.
8. **Roles (decisión 5).** Los permisos actuales solo dicen «ve / no ve». Se añade un permiso aparte para decidir (aprobar, rechazar, ajustar, cambiar reglas), que se concede solo a Dirección o a quien asigne. Los agentes se ejecutan con una identidad de servicio que no puede tenerlo; eso también se prueba.

## 4. Lo que necesito de Dirección para empezar la entrega 1

1. El **Calendario Maestro** (pestañas «Monitoreo», «Datos y decisiones», «Datos Metricool», «Datos FB y LinkedIn»), exportado o con acceso, y dónde está. Sin él no se puede calibrar ni cargar el historial.
2. Quién carga el token de Metricool en los secretos del proyecto (entrega 2).
3. Respuesta a los puntos 1 a 3 de la sección 3 de este documento.

Los pendientes de Dirección (responsable humano, fórmula, base del umbral de Instagram, agentes nuevos) no bloquean la entrega 1: los umbrales se cargan como están y los agentes nuevos ya están decididos en las instrucciones.
