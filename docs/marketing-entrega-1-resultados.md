# Marketing · Entrega 1 — Resultados de carga y calibración

Fecha: 31 oct 2026 · Fuente: `Calendario_Maestro_Kawiil_Nov2026_Ene2027.xlsx` (consulta de Metricool del 31 oct). Estado: **parcial**. Falta el historial desde la API de Metricool.

## Qué no se pudo hacer, y por qué
1. **Historial desde la API de Metricool: no se hizo.** No hay token en el entorno (correcto: lo carga quien administra la cuenta) y todavía no existe el conector de solo lectura (es de la Entrega 2). No se escribió código contra rutas de la API sin poder probarlas. **No puedo informar cuántas publicaciones de Instagram devuelve la API contra las 44 esperadas.**
2. **La carga no se aplicó a ninguna base.** El proyecto de Supabase conectado a esta sesión (`dmhzhyeivvuliumcgsmm`) tiene tablas de otro sistema (motocarros, inventario, remisiones) y no tiene `organizations`; no es Kawiil Central (que según `AGENTS.md` es `qppfampapbxdgednkofc`). No escribí nada ahí. Solo hice lecturas para identificarlo.
   Todo se probó en un Postgres local con tablas de apoyo simuladas. Para aplicarlo en el proyecto correcto: aplicar la migración `20261031120000_marketing_modulo_base.sql` y correr `tools/marketing/carga_historial.sql` sustituyendo `__ORG__`. Se regenera con `tools/marketing/generar_carga.py`.

## Piezas cargadas contra piezas esperadas
Agrupé las publicaciones por fecha y verifiqué que el pilar coincide en todas las redes. Resultado: **48 piezas**.

| Red | Esperadas (instrucción) | En el archivo | Cargadas | Diferencia |
|---|---|---|---|---|
| Instagram | 44 | 26 con alcance + 5 con error (no están en la analítica) | 26 publicadas + 5 «con errores» | **13 a 18 sin datos en el archivo** (ver abajo) |
| Facebook | 47 | 47 | 47 | 0 |
| LinkedIn | 48 | 48 | 48 | 0 |
| **Piezas** | — | — | **48** | — |

- **Instagram:** el archivo trae 26 filas (8 sep – 29 oct). Faltan 18 publicaciones de las 44 (30 jul – 7 sep); se pueden cargar solo desde Metricool. Si las 5 fallidas se cuentan aparte, quedan 18 sin dato en el periodo de 30 jul a 7 sep, donde Facebook y LinkedIn tienen **17** piezas (16 fechas + «Día de los Abuelos»). No cuadra por una: o hay una publicación de Instagram sin pieza en FB/LinkedIn, o dos en un mismo día. Se resuelve con la API.
- **Una pieza sin contraparte:** el 28 de agosto LinkedIn trae dos posts y Facebook uno («Checklist de cierre de agosto»). «Día de los Abuelos» está solo en LinkedIn. Es la única pieza que no sale en las tres redes dentro de lo que muestra el archivo.
- **Las 5 piezas fallidas (22, 23, 24, 26 y 29 sep)** existen como pieza, con estado «con errores» y mensaje «Unknown» en Instagram y «publicada» en Facebook y LinkedIn. Nota: el archivo dice «Con errores» pero no dice si eran piezas programadas ni a qué hora.
- **Horas:** el archivo no trae hora real. Se guardó 11:00 (el archivo dice que todas salieron «cerca de las 11:00») y cada publicación queda marcada `hora_estimada = true`. Etapa 1 para todas; **propósito (conectar/enseñar/vender) en blanco**: el archivo no lo trae y no lo inferí.
- **Cifras sin corte:** todo se cargó como `acumulado` a la consulta del 31 oct, con `fuente = calendario_maestro`. No hay alcance a 48 h ni a 7 d. Las interacciones de Instagram (un número por pieza) quedaron en `extra`, porque el archivo no las desglosa. Comentarios en Facebook y LinkedIn: 0, como dice el archivo.
- **Seguidores:** una sola lectura al 31 oct (IG 154, FB 1,111, LI 1,295), puesta en la semana del 26 oct.

## Caso 1
Cargado como caso 1 (investigación, Instagram, responsable: Revisor, abierto) con 16 piezas de evidencia: 7 hechos y las 9 hipótesis abiertas con su estado, cada una con la celda del archivo de donde sale. Incluye las 5 piezas con error, el hueco del 19 al 30 de septiembre, la caída del 17 y 19, los promedios semanales y que el mensaje es solo «Unknown».

## Calibración del semáforo
Fórmula de Dirección aplicada a las cifras del archivo (acumulado a la consulta, no a 7 días exactos). Umbrales v1. El archivo solo trae cifra **semanal** de Instagram (del 7 sep en adelante). Para Facebook y LinkedIn solo trae el promedio general: lo comparo ahí.

| Semana (lunes) | IG piezas | IG calculado | IG archivo | Dif. | IG | FB piezas | FB calculado | FB | LI piezas | LI calculado | LI |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-07-27 | 0 | — | — | — | gris | 1 | 36.00 | verde | 1 | 37.00 | verde |
| 2026-08-03 | 0 | — | — | — | gris | 3 | 24.33 | verde | 3 | 9.33 | amarillo |
| 2026-08-10 | 0 | — | — | — | gris | 5 | 16.80 | amarillo | 5 | 46.40 | verde |
| 2026-08-17 | 0 | — | — | — | gris | 3 | 14.67 | amarillo | 3 | 3.67 | rojo |
| 2026-08-24 | 0 | — | — | — | gris | 3 | 44.00 | verde | 4 | 29.75 | verde |
| 2026-08-31 | 0 | — | — | — | gris | 1 | 8.00 | rojo | 1 | 5.00 | amarillo |
| 2026-09-07 | 4 | 61.00 | 61.00 | 0.00 | verde | 4 | 23.50 | verde | 4 | 15.50 | amarillo |
| 2026-09-14 | 4 | 58.50 | 58.50 | 0.00 | verde | 4 | 21.50 | verde | 4 | 31.25 | verde |
| 2026-09-21 | 0 | — | — | — | gris | 4 | 17.75 | amarillo | 4 | 10.25 | amarillo |
| 2026-09-28 | 3 | 17.67 | 17.67 | 0.00 | amarillo | 4 | 9.00 | rojo | 4 | 5.50 | amarillo |
| 2026-10-05 | 4 | 25.75 | 25.75 | 0.00 | amarillo | 4 | 16.50 | amarillo | 4 | 10.00 | amarillo |
| 2026-10-12 | 4 | 57.50 | 57.50 | 0.00 | verde | 4 | 17.50 | amarillo | 4 | 4.50 | rojo |
| 2026-10-19 | 4 | 10.25 | 10.25 | 0.00 | rojo | 4 | 6.50 | rojo | 4 | 23.75 | verde |
| 2026-10-26 | 3 | 8.00 | 8.00 | 0.00 | rojo | 3 | 8.33 | rojo | 3 | 0.00 | rojo |

**Lectura:**
- **Instagram:** las 7 semanas con cifra coinciden con el archivo, **diferencia 0.00 en todas**. La del 21 sep sin datos coincide (gris; Dirección fijó que no se oculta la falla: reglas 1 y 3). Para las semanas del 27 jul al 31 ago el archivo no trae Instagram y aparecen en gris por falta de datos, no por falta de piezas.
- **Promedios generales:** Instagram 35.73 (el archivo y los umbrales dicen «35», que es 35.73 truncado), mediana 15; Facebook 18.11 (archivo «18», 18.1); LinkedIn 17.40 (archivo «17», 17.4). Coinciden.
- **Facebook y LinkedIn:** no hay cifra semanal del archivo contra la cual comparar; las cifras de la tabla son las calculadas. Si Dirección tiene una cifra semanal en otra parte, la comparo.
- **Regla de corte (primera publicación en cualquier red):** no generó ningún caso que no cuadre, porque en los datos del archivo cada pieza sale el mismo día en todas las redes. No se pudo probar con datos reales de hora.
- **Semana del 26 oct:** lectura **provisional** (hay piezas con menos de 7 días). En LinkedIn sale rojo con **0 impresiones** en los 3 posts (27, 28 y 29 oct); el archivo mismo pide confirmar si se publicaron o es retraso de datos. Con el semáforo automático sería una falsa alarma probable, o una falla real de publicación.
- **Otros LinkedIn con 0:** 22 sep (una de las fechas donde Instagram falló) y 8 oct. Conviene revisar el estado real de esas dos en la API.
- La semana del 19 oct se considera definitiva solo porque la última pieza (24 oct) cumple 7 días el 31 oct, pero la cifra es el acumulado a esa fecha.

## Pendiente para cerrar la Entrega 1
1. Token de Metricool en los secretos del proyecto correcto y el conector de solo lectura (Entrega 2) para traer el historial real, contar las publicaciones de Instagram contra las 44 y comparar con el archivo semana por semana.
2. Aplicar la migración y la carga en el proyecto de Kawiil Central.
3. Dirección: decidir cuál cifra queda si la API difiere del archivo.
