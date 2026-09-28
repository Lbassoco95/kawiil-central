# RUNBOOK — portal del cliente

## 1. Migraciones (orden)

| # | Archivo | Qué hace | Rollback (a mano, en este orden inverso) |
|---|---|---|---|
| 1 | `supabase/migrations/20260928140000_portal_core.sql` | Cuentas, membresías, ajustes, textos legales (marcadores), bitácora inmutable, funciones de aislamiento, rama del portal en `handle_new_user`, bloqueo de perfil/rol de staff para cuentas del portal | `migrations/2026-09-28_portal_core.rollback.sql` (6.º) |
| 2 | `…140100_portal_messaging.sql` | Hilos, mensajes, adjuntos, lectura, `portal_outbox` | `…portal_messaging.rollback.sql` (5.º) |
| 3 | `…140200_portal_documents.sql` | Bucket privado `portal`, mapeo de carpetas de Dropbox, documentos, publicación | `…portal_documents.rollback.sql` (4.º) |
| 4 | `…140300_portal_cfdi.sql` | Facturas, categorías, reglas, tablero, expediente, CSD (registro + contraseña cifrada), emisiones, cancelaciones | `…portal_cfdi.rollback.sql` (3.º) |
| 5 | `…140400_portal_tickets.sql` | Policies y RPC del portal sobre `fis_receipts`/`fis_cfdi` (Ju'un), vista `portal_tickets_v`, «Facturación de gastos» | `…portal_tickets.rollback.sql` (2.º) |
| 6 | `…140500_portal_isolation_guard.sql` | Policy restrictiva en toda tabla del back-office + storage, y `pgrst.db_pre_request = public.portal_pre_request` | `…portal_isolation_guard.rollback.sql` (1.º) |

- El pipeline (`supabase db push --include-all`) las aplica solas y es forward-only. Los rollback **no** van en `supabase/migrations/` (convención de `migrations/README.md`).
- Ninguna migración borra ni altera datos existentes (probado: huella de datos previos idéntica antes/después y tras el rollback). Los rollback 1–4 son destructivos **solo** para datos del portal.
- La migración 6 registra el pre-request con `ALTER ROLE authenticator`. Si el log del despliegue muestra `WARNING: No se pudo registrar pgrst.db_pre_request` o `ya tiene pgrst.db_pre_request`, hacerlo a mano en el SQL editor:
  ```sql
  ALTER ROLE authenticator SET pgrst.db_pre_request TO 'public.portal_pre_request';
  NOTIFY pgrst, 'reload config';
  ```
  Verificar: `SELECT rolname, setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE rolname = 'authenticator';`
- Si se crea una tabla nueva del back-office **después**, correr `SELECT public.portal_apply_isolation_guard();` (la prueba de base lo exige).

## 2. Variables nuevas (Edge Functions → Secrets)

Detalle en `.env.example` (sección «Portal del cliente»). Mínimo para abrir:

| Variable | Obligatoria | Nota |
|---|---|---|
| `PORTAL_PUBLIC_URL` | sí | Dominio del portal (Polo lo define). También `VITE_PORTAL_PUBLIC_URL` en el build del portal. |
| `CENTRAL_PUBLIC_URL` | sí | Para el enlace del aviso de Slack. |
| `PORTAL_CSD_SECRET` | para CSD | ≥32 caracteres. **No** reutilizar `MOFFIN_FIEL_SECRET`. |
| `PORTAL_EMISOR` | no | `prueba` (por defecto). `pac` solo cuando exista el PAC. |
| `PORTAL_SLACK_CHANNEL_ID` | para avisos | Usa `SLACK_BOT_TOKEN` existente. |
| `PORTAL_EMAIL_SENDER` | para correos | Usa las credenciales Graph existentes (`AZURE_*`/`MICROSOFT_*`); el buzón necesita permiso `Mail.Send` de aplicación. |
| `PORTAL_DROPBOX_APP_KEY/SECRET/REFRESH_TOKEN` | para sincronizar | App de Dropbox propia del portal (ver §5). |
| `PORTAL_ALLOWED_ORIGIN` | recomendado | CORS de `portal-api`. |
| `OPENCLAW_GATEWAY_URL/TOKEN/MODEL/PATH` | no | Vacío = sugerencias apagadas. |

`.env` no se toca. No hay variables nuevas en Vite salvo `VITE_PORTAL_PUBLIC_URL`.

## 3. Pasos manuales en Supabase
1. **Auth → URL Configuration → Redirect URLs**: agregar `PORTAL_PUBLIC_URL/ingresar` y `PORTAL_PUBLIC_URL/restablecer`.
2. **No habilitar el registro público de Auth.** El portal registra por la Edge `portal-api` (service role, marca `kawiil_portal`). Hallazgo preexistente: `handle_new_user` da perfil y rol `en_formacion` de la organización Kawiil a **cualquier** alta sin la marca; si el registro público está activo, cualquiera con la llave pública puede convertirse en staff. Verificar hoy en *Auth → Providers → Email → «Allow new users to sign up»*.
3. Desplegar funciones: `supabase functions deploy portal-api portal-notify portal-dropbox-sync` (verify_jwt=false en `config.toml`; validan el JWT dentro).
4. Probar con `deno check` (los tres pasan; hay 3 errores de tipos preexistentes en `_shared/moffinFielCrypto.ts` y `_shared/satCertificateParser.ts` con Deno 2.x, no introducidos aquí).

## 4. Cron (apagado hasta configurar)
La función `public.invoke_portal_edge_cron(text)` existe pero **no** se programó. Cuando `portal-notify` y Dropbox estén configurados:
```sql
SELECT cron.schedule('portal-notify', '*/2 * * * *', $$SELECT public.invoke_portal_edge_cron('portal-notify')$$);
SELECT cron.schedule('portal-dropbox-sync', '17 */6 * * *', $$SELECT public.invoke_portal_edge_cron('portal-dropbox-sync')$$);
```
Usa el `cron_secret` de Vault ya existente.

## 5. Dropbox
1. Crear una app en dropbox.com/developers con acceso **limitado** (idealmente «App folder» o un equipo con acceso solo a `Kawiil Mx/CLIENTES`). Permisos: `files.metadata.read`, `files.content.read`. Nada de escritura.
2. Obtener refresh token (flujo OAuth offline) y cargar `PORTAL_DROPBOX_*`.
3. En central → Portal de clientes → Dropbox: «Buscar carpetas» y vincular cada carpeta con su cliente **a mano** (hay 137 con duplicados: usar «Ignorar (duplicado)»).
4. «Sincronizar ahora». Todo entra **pendiente**; se publica en la pestaña Publicación.

## 6. Pruebas
```bash
npm run test                         # 33 archivos / 291 pruebas (235 previas + 56 del portal)
PGHOST=… PGPORT=… PGUSER=postgres npm run test:portal-db   # Postgres local ≥15, superusuario; nunca producción
# con PostgREST local frente a la base de prueba (ver README):
PGRST_URL=http://localhost:3055 PGRST_JWT_SECRET=… npm run test:portal-api
```
Fallas preexistentes en base vacía (antes de este cambio): 10 migraciones (`agent_tasks`/`agent_registry` creadas fuera del repo; `digest()` sin `extensions` en el `search_path` de las de contratos). No afectan al portal.

## 7. Encendido gradual
1. Migrar, configurar secretos y desplegar.
2. Sustituir los cuatro textos marcadores (central → Portal de clientes → Catálogos → Textos legales).
3. Crear un cliente sintético y correr los criterios de aceptación en staging.
4. Vincular clientes piloto (los elige Polo).
5. Emisión: sigue en `prueba` hasta que exista PAC; el interruptor por cliente solo se prende con expediente completo.
