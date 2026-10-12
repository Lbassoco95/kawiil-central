# Plan de seguridad de Kawiil OS y conexión con MATI / Kit-to-Drive

**Fecha:** 2026-10-11 · **Estado:** propuesta para revisión. No se ha cambiado código ni configuración.

## 1. Qué encontré

### Cómo está armado hoy lo que vamos a conectar

| Pieza | Repo | Rol |
|---|---|---|
| Kit-to-Drive (front) | `kit-to-drive` | ERP de Dazon (remisiones, almacén, clientes, producción). En producción habla solo con `kit-to-drive-api`. |
| Kit-to-Drive (back) | `kit-to-drive-web` (no entregado) | Migraciones, Edge Functions, RLS. Única fuente de verdad de `supabase/`. |
| Kit-to-Drive (middle) | `kit-to-drive-api` (no entregado) y `mati-api` | Compuerta con lista blanca de tablas/funciones. |
| MATI | `mati-app` | `mati-api` (Express) + `mati-app` + `mati-admin`. |
| **Ya conectado** | | `mati-admin → mati-api /admin/kit-to-drive → Edge Function mati-admin-bridge` (usuarios, config, módulos, tickets, bitácora). Secreto estático en servidor. |
| Kawiil OS | este repo | **Hoy no tiene ninguna integración con MATI ni Kit-to-Drive.** |

Modelo de tres capas de Kit-to-Drive que adoptamos: **Back** = datos, RLS, RPC, Edge Functions · **Middle** = única compuerta, lista blanca, validación · **Front** = solo interfaz, sin llaves.

### Estado de seguridad de Kawiil OS (verificado en el repo y con los avisos de Supabase, solo lectura)

| # | Sev | Hallazgo |
|---|---|---|
| K1 | **Crítico** | `supabase/functions/backup-data` tiene `verify_jwt = false` (`supabase/config.toml`), **no valida ninguna identidad** en su código, usa `SERVICE_ROLE` y, si el cuerpo trae `include_data: true`, **devuelve los datos completos** de las tablas de respaldo, que incluyen `microsoft_tokens`, `savio_webhook_events` y comunicados internos. Cualquiera que conozca la URL podría pedirlos. **No lo probé** (no ejecuté la función). Si la configuración desplegada coincide con el repo, hay que tratarlo como exposición. |
| K2 | Alta | 47 funciones con `verify_jwt = false` (de 108). Algunas son legítimas (webhooks, callbacks OAuth, formulario público), pero otras no muestran validación propia en una búsqueda rápida (`process-document`, `dropbox-browse`, `backup-data`). Requiere revisión una por una. |
| K3 | Alta | 98 funciones `SECURITY DEFINER` ejecutables por el rol `anon` (y por `authenticated`) vía `/rest/v1/rpc/...` (aviso de Supabase). Algunas sirven de helpers de RLS y deberían ser internas. |
| K4 | Media | 177 tablas visibles en el esquema GraphQL para `anon` y para `authenticated` (revela estructura; los datos dependen de RLS). Dos tablas con RLS activo y sin políticas (`client_sat_certificates`, y otra). |
| K5 | Media | CORS `Access-Control-Allow-Origin: *` en ~100 funciones. |
| K6 | Media | Front sin cabeceras de seguridad: `vercel.json` solo trae `Cache-Control` (sin CSP, HSTS, X-Frame-Options, Referrer-Policy). |
| K7 | Media | Autenticación: protección contra contraseñas filtradas desactivada y expiración de OTP mayor a 1 hora. 23 funciones con `search_path` mutable. |

Datos sensibles que Kawiil OS ya maneja y que elevan el riesgo: certificados y claves SAT/FIEL, RFC, finanzas, RH, tokens OAuth de Microsoft/Google/Slack/Dropbox.

## 2. Principios

1. **El navegador nunca habla con MATI ni con Kit-to-Drive.** Solo con Kawiil.
2. **Cero confianza en el front:** cada permiso se decide en servidor; el front solo oculta botones.
3. **Mínimo dato:** el servidor devuelve solo los campos que la pantalla necesita, ya enmascarados.
4. **Todo acceso a datos de otros sistemas deja huella** (quién, qué, cuándo, resultado).
5. **Secretos solo en variables de Edge Functions**, rotables, nunca en el repo ni en el front.

## 3. Arquitectura de conexión propuesta

```
Navegador (Kawiil OS, sesión Supabase)
   │  JWT de usuario
   ▼
Edge Function `integraciones-gateway`        ← MIDDLE de Kawiil
   1. verify_jwt = true + rol permitido (RPC con search_path fijo)
   2. rate limit por usuario
   3. valida entrada (zod) y acción de una lista cerrada (no proxy abierto)
   4. firma la petición (HMAC-SHA256 + timestamp + nonce)
   5. llama a MATI (`mati-api`) / puente de Kit-to-Drive
   6. filtra y enmascara la respuesta (lista de campos permitida)
   7. escribe bitácora `integration_audit`
   ▼
mati-api  →  mati-admin-bridge  →  Kit-to-Drive (BD propia, RLS)
```

Por qué una Edge Function y no un servidor nuevo: es lo que recomienda la propia guía de Kit-to-Drive (`docs/arquitectura-capas.md`: «empezar por Edge Functions»), y evita otro despliegue.

**Credencial entre sistemas:** una credencial de servicio **dedicada a Kawiil**, distinta de la del panel MATI Admin, con alcance mínimo (solo lectura al inicio) y rotación. Nunca se reutiliza el token de superadmin de MATI.

**Dependencia con el proyecto MATI:** para firmar con HMAC y usar una credencial propia, MATI necesita aceptar ese esquema (hallazgo M7 de `informe-seguridad-mati.md`). Hasta entonces la conexión usaría bearer estático con las mitigaciones de abajo.

## 4. Controles por capa

### Back (Supabase de Kawiil)
- Cerrar K1: autenticar `backup-data` (solo admin o secreto de cron comparado en tiempo constante), quitar `include_data` de la respuesta HTTP y escribir solo a Storage privado.
- Revisar las 47 funciones sin JWT; las que no son webhooks pasan a `verify_jwt = true` con rol.
- `REVOKE EXECUTE ... FROM anon` en funciones `SECURITY DEFINER` que no deban ser públicas; `SET search_path` fijo.
- `REVOKE SELECT ... FROM anon` en tablas que no sirven datos públicos; políticas en las dos tablas sin ellas.
- Tabla `integration_audit` (append-only, RLS: solo admin lee; nadie edita) y `integration_secrets` solo para service role.
- Activar protección de contraseñas filtradas y bajar el OTP a ≤ 1 h.
- Respaldos: cifrados y con acceso restringido.

### Middle (Edge Functions)
- Módulo compartido `_shared/security.ts`: `requireUser`, `requireRole`, CORS con lista de orígenes (no `*`), `rateLimit`, `audit`, `maskFields`, `hmacSign`.
- `integraciones-gateway` según §3. Respuestas con `Cache-Control: no-store`; errores genéricos hacia el cliente, detalle solo en logs.
- Cifrado de tokens de terceros en reposo (hoy no verifiqué cómo se guardan `microsoft_tokens` y similares; es parte de la revisión).
- Reglas ESLint para impedir secretos y llamadas directas a MATI desde `src/`.

### Front (Kawiil OS)
- Cabeceras en `vercel.json`: CSP (sin `unsafe-eval` si es posible), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Los datos de MATI/Kit-to-Drive solo en memoria (React Query, sin `persist`, sin `localStorage`), con `gcTime` corto.
- Campos sensibles enmascarados por defecto (RFC, correos, teléfonos); "ver completo" pide al servidor y queda en bitácora.
- Cierre de sesión por inactividad; ocultar contenido al cambiar de pestaña en pantallas sensibles (opcional).
- Nada de contraseñas temporales visibles: solo por correo, como en Kit-to-Drive.

## 5. Fases

| Fase | Contenido | Resultado |
|---|---|---|
| **0 — Contención (días)** | K1, K2 (revisión de las 47), revisar logs de `backup-data`, rotar tokens de Microsoft si hay indicio de acceso | Sin exposición abierta |
| **1 — Base (1–2 sem)** | `_shared/security.ts`, cabeceras front, K3/K4 (revoke anon), auth (K7), CORS | Línea base segura |
| **2 — Conexión de solo lectura** | `integraciones-gateway`, `integration_audit`, pantalla de estado MATI/Kit-to-Drive en Kawiil OS | Datos visibles de forma segura |
| **3 — Escritura controlada** | Acciones (alta de usuario, módulos) con confirmación y doble registro; HMAC end-to-end cuando MATI lo soporte | Operación desde Kawiil OS |
| **4 — Sostenimiento** | Pruebas automáticas de seguridad (roles, enmascarado, funciones sin JWT), revisión trimestral de avisos de Supabase | Que no se regrese |

## 5.1 Estado de la Fase 0 (2026-10-11)

Desplegado en producción (proyecto `qppfampapbxdgednkofc`) y reflejado en la rama:

| Función | Antes | Ahora | Versión |
|---|---|---|---|
| `backup-data` | Sin JWT ni validación; con `include_data` devolvía todos los datos | `verify_jwt = true`, exige admin/gerente, ya no devuelve datos por HTTP | v63 |
| `microsoft-secret-health` | Abierta; renovaba tokens reales de `microsoft_tokens` | Solo admin/gerente o `x-cron-secret` (ahora también está en el repo) | v8 |
| `slack-notify` | Cualquiera podía publicar en el Slack de Kawiil | Exige service role o sesión válida | v67 |
| `mtg-graph-admin` | Abierta; `mock: true` insertaba filas con service role | Exige `x-cron-secret` | v4 |
| `refresh-weekday-phrases` | Aceptaba cualquier bearer de más de 16 caracteres | Solo service role exacto o cron secret | v64 |
| `travel-refresh` | Si faltaba `CRON_SECRET`, quedaba abierta | Falla cerrada | v8 |

**Pendiente de desplegar:** `process-document` (parchada en la rama, 639 líneas; se despliega con el flujo normal para no retranscribirla a mano). Hasta entonces sigue aceptando llamadas sin identidad.

**Pendiente de revisar:** `satgo-facturas` (existe en producción pero no en el repo), `moffin-webhook`, `meta-webhook-leads`, `calendly-webhook` y `email-tracking` (webhooks/públicas: confirmar firma), y el resto de las funciones sin JWT.

**Acciones fuera del código:** revisar logs de más de 24 h de `backup-data` en el panel de Supabase (la herramienta solo cubre 24 h; en ese lapso no hubo llamadas) y decidir si se rotan los tokens de Microsoft.

## 5.2 Estado de la Fase 1 (2026-10-11)

| Pieza | Estado |
|---|---|
| Cabeceras de seguridad del front (`vercel.json`): HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` | En la rama. Se aplican al fusionar y desplegar. |
| CSP | En modo **solo reporte** (`Content-Security-Policy-Report-Only`): no bloquea nada. Revisar la consola del navegador unos días y luego pasarlo a `Content-Security-Policy`. |
| Migración `20261011230000_fase1_endurecer_anon_y_rpc.sql` | ✅ **Aplicada en producción (2026-10-11)** desde el SQL Editor de Supabase y **verificada** con lecturas (ver abajo). Los intentos desde la sesión (`execute_sql`/`apply_migration`) caducaron a los 60 s y no aplicaron nada. |
| Contraseñas filtradas y OTP | Solo se cambian en el panel de Supabase (Authentication → Providers/Policies). |

**Qué hizo la migración:** quitó 3 políticas abiertas a cualquiera (`knowledge_insights` insert/update y `knowledge_feed` insert), dejó las funciones internas (cron, colas, `get_edge_fn_source`, `*_system`) solo para `service_role`, quitó a `anon` la ejecución de las demás funciones `SECURITY DEFINER` salvo las 5 necesarias, y retiró a `anon` los permisos de escritura sobre las tablas (también por defecto para objetos nuevos). **No tocó:** `contract_client_get/patch` (portal público por token), `get_user_org_id`, `is_admin_or_manager` y `can_edit_org_permission_settings` (las usan políticas que aplican a anon).

**Verificación posterior (solo lecturas, 2026-10-11):**

| Comprobación | Antes | Después |
|---|---|---|
| Políticas abiertas (`Service insert/update …`) | 3 | 0 |
| Funciones `SECURITY DEFINER` ejecutables por `anon` | 98 | 5 (`can_edit_org_permission_settings`, `contract_client_get`, `contract_client_patch`, `get_user_org_id`, `is_admin_or_manager`) |
| Permisos de escritura de `anon` sobre tablas | 706 | 0 |
| Funciones solo para `service_role` | 0 | 27 |
| Funciones solo para `authenticated` + `service_role` | 0 | 67 |
| Aviso Supabase «anon puede ejecutar SECURITY DEFINER» | 98 | 5 |

Comprobadas una a una: `claim_jobs`, `complete_job`, `fail_job`, `get_edge_fn_source`, `invoke_travel_refresh_cron`, `enqueue_sequence_system` y `pipeline_calendly_apply_system` ya no son ejecutables por `anon` ni `authenticated` (sí por `service_role`); `assign_lead`, `move_lead_stage`, `rh_start_jornada` y `has_role` siguen ejecutables por `authenticated`.

**Nota sobre el PR #369:** como la migración se aplicó a mano, no quedó registrada en `supabase_migrations.schema_migrations`. Al fusionar, `supabase db push` volverá a ejecutar el archivo; es idempotente, así que no cambia nada.

**Sin verificar:** que ningún flujo de la aplicación se haya visto afectado. Probar login, portal público de contratos, pipeline de leads, RH (iniciar jornada) y knowledge. Rollback puntual: devolver `EXECUTE` a `anon` solo en la función afectada.

**Pendiente en base de datos (avisos de Supabase tras la migración):** 177 tablas visibles por GraphQL para `anon` y `authenticated`, 72 funciones abiertas a `authenticated`, 23 con `search_path` mutable, 2 tablas con RLS sin políticas, y el aviso de `pg_trgm` en el esquema público.

**Decisión pendiente:** las tablas `agent_registry`, `agent_tasks` y `agent_activity_logs` son legibles por cualquiera con la clave pública (`anon_read_*`, `true`). Probablemente las lee un agente externo con la clave anon; hay que confirmarlo antes de cerrarlas.

## 5.3 Reparación del historial de migraciones (2026-10-12)

**Problema:** `Deploy Supabase` fallaba en «Push migrations» con `Remote migration versions not found in local migrations directory` (ejecuciones #136, #138, #139 y #140). Producción tenía 16 migraciones registradas que no existían en `supabase/migrations/`, porque se aplicaron a mano con otra numeración.

**Reparación (sin escribir en la base de producción):** se recrearon esas 16 migraciones en el repo con el SQL exacto que quedó guardado en `supabase_migrations.schema_migrations`, cada una con su misma versión y nombre. Cada archivo se verificó contra el `md5` que calcula la base (coinciden las 16).

| Versión | Nombre |
|---|---|
| 20260925014308 · 014354 · 020641 · 022629 | `contract_engagements_mvp`, `contract_templates_seed`, `contract_won_stage_softlanding_rfc`, `contract_rpc_schema_reload` |
| 20260930025108 · 150806 · 210647 · 224934 | `mtg_unassigned_meetings`, `satgo_monthly_cron`, `moffin_consults_buzon_types`, `mtg_bucket_file_size_limit_500mb` |
| 20261001160110 | `mtg_recording_saved_meta` |
| 20261004164053 · 164139 · 192226 | `satgo_cfdi_auto_download`, `satgo_cfdi_cron`, `kawiil_vault_secret_os_mirror` |
| 20261005164935 · 20261006024112 · 20261006215158 | `rh_start_jornada_rpc`, `satgo_cfdi_enrich_structured`, `facturapi_org_mapping` |
| 20261011225226 | `esign_simple` |

Con esto no queda ninguna versión del remoto sin archivo local (272 de 272).

**Qué pasará al fusionar:** `supabase db push --include-all` aplicará los 17 archivos locales que el remoto no tiene registrados. Se revisó que no cambie nada:
- 10 son gemelos de las migraciones recuperadas (mismo SQL; solo difieren comentarios y espacios). Producción ya tiene ese SQL aplicado a mano.
- 6 no tienen gemelo (`lead_client_referrals`, `contract_pgcrypto_search_path`, `rh_jornada_repairs`, `add_nomina_service`, `contract_client_fields_and_service_sync`, `client_sat_certificates_satgo_jwe`): sus objetos ya existen en producción (columnas, constraint, política, valor de enum y `search_path`).
- La 17.ª es `20261011230000_fase1_endurecer_anon_y_rpc.sql`, ya aplicada e idempotente.
- Ninguna re-ejecución devuelve permisos a `anon`; las únicas concesiones a `anon` son `contract_client_get/patch`, que son públicas a propósito.

El efecto neto es registrar esas versiones en el historial. **Deuda que queda:** los gemelos duplican el SQL bajo dos versiones (p. ej. `20260924120000` y `20260925014308`). En una base nueva se ejecutarían las dos veces; es inocuo porque son idempotentes, pero conviene eliminar los duplicados locales más adelante.

**Corrección tras el primer despliegue (2026-10-12):** `db push` aplicó 12 de los archivos sin registrar y se detuvo en `20260930200000_moffin_consults_buzon_types`: el gemelo recreaba un `CHECK` viejo de `moffin_consults`, que una migración posterior ya había ampliado (`satgo_cfdi_download`, 175 filas), así que fallaba. Re-ejecutar un gemelo no es siempre inocuo cuando una migración posterior cambió el mismo objeto. Se eliminaron los 4 gemelos que aún no se habían aplicado (`20260930200000`, `20260930230000`, `20261001160000`, `20261005170000`), idénticos a su versión ya registrada. Los 12 gemelos ya aplicados quedan en el repo porque ahora forman parte del historial del remoto.

**Segunda corrección (2026-10-12):** el siguiente despliegue falló en `20261011120000_esign_simple` (gemelo de `20261011225226`, ya registrado): su `CREATE POLICY` no es idempotente y la política ya existía. Se eliminó ese gemelo. `20261012010000_esign_fix_rls_recursion` se conserva: usa `CREATE OR REPLACE` y `ALTER POLICY`, y las políticas de producción ya coinciden con él. Criterio para los gemelos pendientes: quitarlos si su SQL no es idempotente o si una migración posterior cambió el mismo objeto.

**Causa de fondo:** se aplican migraciones directamente en producción (panel o conector) sin versionarlas. Regla propuesta: toda migración se escribe primero en `supabase/migrations/` y la aplica el CI.

## 6. Decisiones que necesito de ti

1. **¿Qué roles de Kawiil pueden ver datos de Kit-to-Drive/MATI?** (propongo solo dirección y administración al inicio).
2. **¿Qué datos mostramos primero?** (propongo estado, usuarios activos, módulos y tickets: lo que el puente ya expone).
3. **¿Permito empezar por la Fase 0?** Toca configuración en producción (`config.toml` y despliegue de funciones), así que no la ejecuto sin tu confirmación.
4. **¿Acceso a `kit-to-drive-web` y `kit-to-drive-api`?** Sin ellos no puedo revisar la Edge Function del puente ni la lista blanca.
