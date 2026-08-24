# Tipo de cambio Banxico en el topbar

Junto al widget del clima, el topbar muestra el **tipo de cambio para solventar
obligaciones denominadas en moneda extranjera pagaderas en la República
Mexicana** (el que publica Banxico en el DOF y el que aplica fiscalmente).
Al hacer clic en la píldora se abre el detalle: variación contra la publicación
anterior, fecha de publicación y el tipo de cambio FIX como referencia.

## Series consultadas

| Serie | Descripción | Uso |
|-------|-------------|-----|
| `SF60653` | Tipo de cambio pesos por dólar E.U.A. para solventar obligaciones denominadas en moneda extranjera (fecha de liquidación) | Dato principal de la píldora |
| `SF43718` | Tipo de cambio FIX | Referencia en el detalle |

Banxico publica **un solo dato por día hábil**, alrededor del mediodía (hora del
centro). El frontend refresca cada 30 minutos, así que el dato del día aparece
solo el mismo día en que se publica; los fines de semana y días inhábiles se
mantiene la última publicación (la píldora muestra la fecha para que quede claro).

## Configuración (requiere token de Banxico)

La consulta la hace la edge function `banxico-fx`, para que el token nunca viaje
al navegador. Hay que darle el secret **una sola vez**:

1. Consigue un token gratuito en
   <https://www.banxico.org.mx/SieAPIRest/service/v1/token>.
2. Guárdalo como secret del proyecto de Supabase:

   ```bash
   supabase secrets set BANXICO_TOKEN="<token>" --project-ref qppfampapbxdgednkofc
   ```

   (o desde el dashboard: *Edge Functions → Secrets*).

La función se despliega automáticamente al integrar a `main` (workflow
`Deploy Supabase`). Mientras no exista el secret, la píldora muestra
"Sin configurar" y el detalle explica qué falta; no rompe el topbar.

## Diagnóstico

| Síntoma | Causa |
|---------|-------|
| "Sin configurar" | Falta `BANXICO_TOKEN`, o la función aún no está desplegada |
| `banxico_error` con status 401/403 | El token es inválido o fue revocado |
| `banxico_sin_datos` | Banxico respondió sin datos para la ventana consultada (20 días naturales) |

Los logs de la función (`supabase functions logs banxico-fx`) registran el
estatus y el detalle de Banxico, nunca el token.
