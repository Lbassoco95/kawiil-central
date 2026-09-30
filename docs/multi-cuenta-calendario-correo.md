# Multi-cuenta / multi-proveedor de calendario y correo

Objetivo: que el calendario de Kawiil deje de estar atado a una sola cuenta de
Microsoft 365 y se convierta en una **agenda de seguimiento de actividades** que
agrega calendarios/correos de varias cuentas y proveedores (Microsoft, Google y,
en el futuro, IMAP/SMTP).

Este documento describe la arquitectura, lo que ya quedó implementado en esta
rama y los pasos pendientes de configuración (credenciales) para activarlo.

---

## 1. Modelo de datos

Tabla genérica `public.linked_accounts` (migración
`supabase/migrations/20260707120000_linked_accounts_multi_provider.sql`):

| Columna | Uso |
|---------|-----|
| `provider` | `microsoft` \| `google` \| `imap` |
| `email`, `display_name`, `provider_account_id` | identidad de la cuenta |
| `access_token`, `refresh_token`, `token_expires_at`, `scope` | OAuth (microsoft/google) |
| `imap_host/port/username/password`, `smtp_host/port`, `smtp_use_tls` | IMAP/SMTP |
| `status` | `connected` \| `error` \| `disconnected` |
| `calendar_enabled`, `mail_enabled` | qué capacidades usa esta cuenta |
| `last_sync_at`, `last_error` | diagnóstico |

**Seguridad:** RLS por `user_id`. Los tokens y la contraseña IMAP **no** se
exponen al cliente: se usan *GRANTs a nivel de columna* para que `authenticated`
solo pueda leer/editar metadatos, mientras que las edge functions (service_role)
son las únicas que leen los secretos.

> Pendiente producción: cifrar `imap_password` (pgsodium / Supabase Vault) en vez
> de texto plano.

La tabla `microsoft_tokens` existente se mantiene por compatibilidad. Migración
futura opcional: mover Microsoft a `linked_accounts` para un modelo único.

---

## 2. Google Calendar (implementado)

Edge functions nuevas:

- `google-auth` — inicia OAuth, devuelve la URL de consentimiento.
- `google-callback` — intercambia el code, obtiene identidad (`userinfo`) y hace
  upsert en `linked_accounts` (`provider = google`).
- `google-api` — acciones `calendars` y `calendar-events`. Refresca el token si
  expiró y **normaliza** los eventos de Google al formato tipo Microsoft Graph
  (`subject`, `start.dateTime`, `location.displayName`, …) para que el frontend
  los pinte igual. Cada evento se etiqueta con un `calendarId` con namespace
  (`google:<accountId>:<calId>`) y `_source: "google"`.

Frontend:

- `src/hooks/useLinkedAccounts.ts`: `useLinkedAccounts`, `useGoogleConnection`
  (connect/disconnect) y `useGoogleCalendarEvents`.
- `CalendarView` fusiona los eventos de Google con los de M365, colorea por
  calendario y muestra una sección **Cuentas** en el panel derecho para conectar
  o quitar cuentas de Google. Los eventos de Google son de solo lectura desde
  Kawiil (se puede crear una tarea a partir de ellos, no editarlos/eliminarlos).

### Pasos de configuración (requiere acción manual)

1. En **Google Cloud Console** → APIs & Services:
   - Habilitar **Google Calendar API**.
   - Crear credenciales **OAuth 2.0 Client ID** (tipo *Web application*).
   - Redirect URI autorizado:
     `https://<SUPABASE_PROJECT>.supabase.co/functions/v1/google-callback`
   - Pantalla de consentimiento: agregar el scope
     `https://www.googleapis.com/auth/calendar` y los testers, o publicar la app.
2. En **Supabase → Project Settings → Edge Functions → Secrets**:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
3. Aplicar migración y desplegar funciones:
   ```bash
   supabase db push
   supabase functions deploy google-auth google-callback google-api --no-verify-jwt
   ```
4. En el calendario, panel derecho → **Cuentas → Conectar cuenta de Google**.

---

## 3. IMAP / SMTP (pendiente — solo correo)

IMAP/SMTP cubre **correo**, no calendario (para calendario de terceros se usaría
CalDAV, fuera de alcance por ahora). Plan:

- UI: formulario para dar de alta host/puerto/usuario/contraseña (guardar en
  `linked_accounts` con `provider = imap`, cifrando la contraseña).
- Edge function `imap-api` (Deno) que use una librería IMAP para listar/leer
  correos y SMTP para enviar. Como las edge functions tienen límites de tiempo,
  conviene sincronizar a una tabla `emails_cache` mediante un cron en vez de
  consultar IMAP en cada request.
- El buzón unificado (`EmailView`) leería de `linked_accounts` + `emails_cache`
  en lugar de asumir Microsoft.

---

## 3b. Trayecto con tráfico + autocompletado de lugares (Google Maps)

Al abrir/crear un evento con **Ubicación**, se puede calcular el **tiempo de
trayecto con tráfico** (y la hora sugerida de salida), y los campos de ubicación
y punto de salida ofrecen **autocompletado de lugares**. Todo pasa por edge
functions para que la API key viva **solo en el servidor**.

- `maps-travel` → Google **Distance Matrix API** (`departure_time`,
  `traffic_model=best_guess`, `region=mx`, `units=metric`, `language=es`).
  Devuelve duración con tráfico + base + distancia. 500 si falta la key; maneja
  `ZERO_RESULTS`/`NOT_FOUND`/`REQUEST_DENIED` sin romper la UI.
- `maps-places` → Google **Places API (New)** (`places:autocomplete`,
  `regionCode=MX`, `languageCode=es`). Degrada a lista vacía + motivo si falla.
- Frontend: `useTravelTime`, `usePlacesAutocomplete`, componentes
  `EventTravelSection` y `PlaceAutocompleteInput`.

### Configuración en Google Cloud (acción manual)

1. Habilitar **Distance Matrix API** y **Places API (New)** (¡la *New*, no la
   legacy!) en el mismo proyecto, con **billing activo**.
2. Secret en Supabase: `GOOGLE_MAPS_API_KEY`.
3. Restricciones de la API key:
   - **Aplicación = Ninguno**. La restricción por *HTTP referrer* (Sitios web)
     **rompe** las llamadas server-side (la edge function no manda referrer);
     el síntoma es "Places API no está habilitada o la key no la permite".
   - **API = restringir** a *Distance Matrix API* + *Places API (New)*.
4. Desplegar: `supabase functions deploy maps-travel maps-places --no-verify-jwt`.

> ⚠️ **Pendiente de seguridad:** la key actual se expuso en un chat y quedó sin
> candado de dominio. **Rotarla**: crear una nueva (App = Ninguno, API restringida
> a Distance Matrix + Places API New), cargarla en `GOOGLE_MAPS_API_KEY` y borrar
> la anterior.

---

## 4. Roadmap sugerido

1. ✅ Anti-encimamiento de eventos (carriles).
2. ✅ Crear tarea/actividad desde un evento.
3. ✅ Vista Agenda + multi-calendario dentro de M365.
4. ✅ Google Calendar (multi-cuenta) — falta configurar credenciales.
5. ✅ Trayecto con tráfico + autocompletado de lugares (Distance Matrix + Places New).
6. ⬜ Unificar Microsoft en `linked_accounts`.
7. ⬜ IMAP/SMTP para correo (con caché + cron).
8. ⬜ Rotar la `GOOGLE_MAPS_API_KEY` expuesta.
7. ⬜ Cifrado de secretos IMAP (Vault/pgsodium).

---

## 5. Incidentes: client secret de Microsoft expirado (AADSTS7000222)

Si Calendario / Correo muestra `auth_config_expired`, `Token refresh failed`,
`invalid_client` o `AADSTS7000222`, **no es un bug del calendario**: el client
secret de la App Registration en Azure AD está caducado o mal pegado en Supabase.

App ID: `db370917-4e36-4ef5-b152-322394f50980` (proyecto Supabase
`qppfampapbxdgednkofc`).

### Remedio operativo (admin)

1. Azure Portal → **App registrations** → app `db370917-…` → **Certificates &
   secrets** → **New client secret** (o usar el Value del secreto vigente).
2. Copiar el **Value** del secreto (no el Secret ID). Solo se muestra una vez.
3. Supabase → **Edge Functions → Secrets** → poner el **mismo Value** en:
   - `MICROSOFT_CLIENT_SECRET` (lo usan `microsoft-callback`, `microsoft-api`,
     calendario, OAuth)
   - `AZURE_CLIENT_SECRET` (pipeline/mail; debe coincidir si es la misma app)
4. No hace falta redeploy solo por rotar el secreto.

Errores Azure habituales al pegar mal el secreto (sonda y callback los distinguen):

| Código Azure | Significado | Qué hacer |
|---|---|---|
| `AADSTS7000222` | Secret **expirado** (sigue el Value viejo en `MICROSOFT_CLIENT_SECRET`) | Pegar el **Value** del secreto nuevo |
| `AADSTS7000215` | Secret **inválido** (typo, truncado, o se pegó el **Secret ID**) | Copiar el **Value**, no el Secret ID |

Estado verificado 2026-09-28 en `qppfampapbxdgednkofc`: `MICROSOFT_CLIENT_SECRET`
seguía en `7000222` y `AZURE_CLIENT_SECRET` en `7000215` (Values distintos y ambos
malos). Mientras Azure responda así, Calendario mostrará `auth_config_expired` al
conectar — **no es un bug del front**.

### Verificación end-to-end (sonda)

Edge Function desplegada: `microsoft-secret-health` (`verify_jwt = false`).

```bash
curl -sS "https://qppfampapbxdgednkofc.supabase.co/functions/v1/microsoft-secret-health" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

OK cuando el JSON tiene:

- `auth_config_expired: false`
- `secret_status: "OK"`
- `live_refresh.status: "OK"` **o** `"RECONNECT_REQUIRED"` (secret bien; el
  usuario debe reconectar Microsoft en Calendario)
- `azure_alias_matches_microsoft: true` (si ambos secretos están configurados)

Si `live_refresh` es `AUTH_CONFIG_EXPIRED` o `client_credentials` reporta
`7000222`, el Value en `MICROSOFT_CLIENT_SECRET` **aún no** es el secreto vigente
de Azure: vuelve al paso 2–3.

Tras `secret_status: OK`, conectar/reconectar Microsoft en Calendario (flujo
`microsoft-auth` → Azure → `microsoft-callback`) y confirmar que ya no aparece
`auth_config_expired` en el HTML de error del callback.
