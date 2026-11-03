# Marketing · Conector Metricool (solo lectura) — mapa de la API y lista cerrada

Fuente: swagger «Metricool API» v2.0.0 entregado por Dirección el 31 oct 2026. Base: `https://app.metricool.com/api`.
Estado: **diseño; nada implementado ni llamado todavía.** `app.metricool.com` está bloqueado en la sesión de desarrollo.

## 1. Autenticación y variables (nombres exactos)

El token va en el encabezado `X-Mc-Auth`. `userId` y `blogId` van como parámetros de consulta.
Variables de la Edge Function (las carga Dirección en el panel de Supabase; su valor nunca pasa por chat, repositorio ni documentación):

| Variable | Contenido |
|---|---|
| `METRICOOL_USER_TOKEN` | token de API de la cuenta (secreto) |
| `METRICOOL_USER_ID` | identificador de usuario de la cuenta |
| `METRICOOL_BLOG_ID` | identificador de la marca (Kawiil MX) |

Si se desconoce `userId`/`blogId`, se obtienen con `/admin/simpleProfiles` (solo lectura) una vez cargado el token.

## 2. Por qué la lista es de rutas exactas y no «solo GET»

En el swagger muchos GET **modifican** datos, por ejemplo: `/admin/profile/setproperty`, `/admin/update-label-blog`, `/admin/delete-profile`, `/admin/restore-profile`, `/lists/delete`, `/lists/posts/deleteall`, `/lists/update`, `/stats/gmb/review/reply`, `/stats/gmb/review/reply/remove`, `/stats/deletecomment/{provider}`, `/stats/postmessage/{provider}`, `/stats/twitter/follow`, `/stats/facebook/boost/{postId}`. Por eso el método HTTP no es garantía. El conector solo permite las rutas de la tabla siguiente, con método GET, y rechaza todo lo demás (incluidos parámetros de ruta no listados y cualquier método distinto de GET).

## 3. Lista cerrada de rutas de lectura

| Ruta (GET) | Uso | Estado de verificación |
|---|---|---|
| `/v2/analytics/posts/instagram` | publicaciones de Instagram y métricas (alcance) por periodo | por probar en Entrega 2 |
| `/stats/facebook/posts` | publicaciones de Facebook con métricas | parámetros no documentados (`start`/`end` sin verificar) |
| `/stats/linkedin/posts` | publicaciones de LinkedIn con métricas (impresiones) | parámetros no documentados |
| `/v2/scheduler/posts` | calendario: estado por red (`status`, `detailedStatus`) | por probar |
| `/v2/scheduler/posts/{id}` | detalle de una publicación programada | por probar |
| `/v2/scheduler/posts/{uuid}/events` | historial de eventos de una publicación (motivo de error) | por probar |
| `/v2/analytics/timelines` | seguidores por semana | por probar |
| `/admin/simpleProfiles` | obtener `userId`/`blogId` | por probar |
| `/v2/settings/users/{userId}/api-usage-stats` | consumo de la API (medir límites) | por probar |

Notas: los endpoints v2 de Facebook y LinkedIn (`/v2/analytics/posts/facebook|linkedin`) devuelven CSV, por eso se usan los antiguos `/stats/...` salvo que la prueba demuestre lo contrario; añadir cualquier ruta nueva exige registrarla aquí y que Dirección la apruebe. El swagger no documenta límites de consulta; se miden en la Entrega 2.

## 4. Prueba que falla si una llamada sale de la lista

Prueba automática (Deno, en `supabase/functions/marketing-metricool/` cuando se construya):
1. Reemplaza `fetch` por un espía y ejecuta cada operación del conector con entradas válidas, extremas y hostiles (rutas con `..`, `//`, `?`, `%2e`, mayúsculas, ids con `/`, métodos POST/PUT/PATCH/DELETE/HEAD).
2. **Falla** si alguna petición saliente tiene un método distinto de GET, un host distinto de `app.metricool.com`, o una ruta que no coincide exactamente (tras normalizar) con una de la tabla 3.
3. **Falla** si el conector acepta una ruta fuera de la lista en vez de rechazarla antes de llamar a `fetch`.
4. **Falla** si el token aparece en cualquier registro, en la respuesta o en la bitácora.
5. Comprueba que cada llamada real escribe una fila de registro (ruta, método, estado, duración) en `mk_api_log` (tabla por crear en Entrega 2, con confirmación de Dirección).
Se ejecuta en CI y antes de cada despliegue de la función.

## 5. Garantía y límites
La solo lectura es de software, no de la plataforma: el token da acceso completo a la cuenta. Mitigaciones: token solo en secretos de la función; ni la interfaz ni los agentes lo ven; lista cerrada de rutas; registro de cada llamada; la prueba de arriba.
