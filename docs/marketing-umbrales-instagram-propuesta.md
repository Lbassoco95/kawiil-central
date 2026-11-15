# Marketing · Propuesta de umbrales del semáforo de Instagram (15 nov 2026)

Estado: **solo propuesta**. No se escribió nada en producción. Cambiar la regla va por `mk_cambiar_regla` con motivo y confirmación de Dirección.

## Regla vigente (v1)
`semaforo_instagram`: medida alcance, **verde desde 35**, **amarillo desde 15**, rojo por debajo. Salió de 26 piezas (8 sep – 29 oct): media 35.7, mediana 15.

## Datos nuevos (Metricool, acumulado a la fecha de lectura)
43 piezas con alcance (de 44 publicaciones; una sin cifra), del 31 jul al 29 oct 2026.

| Medida | Valor |
|---|---|
| Media | 46.0 |
| Mediana | 30 |
| Percentil 25 / 75 | 13 / 67.5 |
| Mínimo / máximo | 8 / 167 |

Valores ordenados: 8, 8, 9, 9, 9, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 16, 17, 18, 20 | 30, 31 | 37, 50, 56, 59, 61, 62, 64, 65, 66, 69, 71, 79, 80, 80, 87, 98, 130, 130, 137, 167.

Lo que se ve:
- **La distribución tiene dos grupos**: 21 piezas entre 8 y 20 y 20 piezas entre 37 y 167; en medio solo hay dos (30 y 31).
- **La mediana cae justo en el hueco** entre los dos grupos. Por eso saltó de 15 a 30 al agregar piezas: no es una señal estable.
- Con los umbrales actuales, las 43 piezas se reparten en 20 verdes, 9 amarillas y 14 rojas.
- Por formato (Metricool): carrusel, 15 piezas, media 37.3 y mediana 15; imagen única, 11 piezas, media 34.8 y mediana 14; sin formato registrado, 17 piezas, media 60.9 y mediana 61. Las 17 sin formato son las anteriores al calendario; no sabemos qué tipo de contenido eran.

## Cómo quedarían las 13 semanas con cifra (semana de Instagram del 21 sep sigue gris)

| Opción | Verde / Amarillo / Rojo | Semanas (lunes) |
|---|---|---|
| **A. Mantener 35 / 15** | 8 / 2 / 3 | 27 jul R · 3–14 sep V · 28 sep A · 5 oct A · 12 oct V · 19 y 26 oct R |
| B. Mismo método de la v1 (media y mediana): 46 / 30 | 6 / 2 / 5 | 27 jul R · 3 ago A · 10 ago V · 17 ago A · 24 ago–14 sep V · 28 sep R · 5 oct R · 12 oct V · 19 y 26 oct R |
| C. Intermedia 40 / 20 | 8 / 1 / 4 | como A, pero 28 sep pasa a R |
| D. Media y mediana de los promedios semanales (45 / 18) | 6 / 4 / 3 | 3 y 17 ago A; el resto como A |

(El promedio semanal es el que compara el semáforo; la media semanal es 43.3 y la mediana semanal 44.7.)

## Recomendación: mantener 35 / 15 por ahora y registrar la nota
1. **El mismo método da un resultado inestable.** La mediana de 43 piezas (30) depende de dónde caiga el hueco entre los dos grupos; con una pieza más podría volver a bajar.
2. **Los datos no son comparables entre sí todavía.** Es alcance *acumulado a la fecha de lectura*: una pieza de julio lleva más de tres meses acumulando y una del 29 oct, dos semanas. Los cortes de 48 h y 7 días (paso posterior de la Entrega 2) permiten comparar piezas a igual edad.
3. **Las opciones B y D castigan más** (5 y 3 semanas rojas contra 3) sin que haya evidencia de que el criterio de hoy esté mal calibrado.
4. La revisión ya está calendarizada: la regla `revision_resultados` fija el 30 nov, el 31 dic y el 14 ene. Con los cortes a 48 h y 7 días se recalcula el 30 nov.

Si Dirección prefiere cambiar ya, la opción más defendible es **C (40 / 20)**; B y D solo si se quiere seguir literalmente el método de la v1.

## Cómo se aplicaría (no hecho)
- `mk_cambiar_regla('semaforo_instagram', {...}, true, motivo)` exige `mk_can_decide()` con la sesión de Dirección (`auth.uid()`); **no se puede llamar desde el servicio ni desde esta herramienta**. Hoy la pantalla no tiene un botón para cambiar reglas.
- Para **mantener 35 / 15**: solo registrar la nota de `supabase/migrations/20261115195017_marketing_nota_umbral_instagram.sql` (`UPDATE` de `descripcion` más una entrada de bitácora; no cambia versión ni colores). **Decisión de Dirección del 15 nov: mantener 35 / 15.**
- Para **cambiar a otros umbrales**: Dirección lo ejecuta con su sesión (o se agrega una pantalla de reglas con confirmación, trabajo aparte). Después habría que **recalcular el semáforo** con `mk_recalcular_semaforo` y ese recálculo necesita su propia confirmación.
- Reversa de un cambio de regla: otra llamada a `mk_cambiar_regla` con los parámetros anteriores (queda en `mk_regla_historial`).
