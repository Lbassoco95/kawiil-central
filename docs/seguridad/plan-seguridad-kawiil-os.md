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

## 5.4 Cierre de pendientes de las fases 0 y 1 (2026-10-12)

**Verificado con los registros de Supabase (ventana máxima de 24 h):**

| Pendiente | Resultado |
|---|---|
| ¿Se rompió algo al cerrar `anon`? | No hay señales: 7 812 peticiones, **0 respuestas 401/403**. Los 75 errores 500 eran `esign_requests/esign_signers` (recursión de RLS) y dejaron de aparecer a las 01:12 UTC tras el arreglo de la sesión de firmas. Esto no sustituye probar las pantallas a mano. |
| ¿`CRON_SECRET` está configurado? | Sí: `travel-refresh` respondió 200 en 96 de 96 llamadas con el control fail-closed activo. |
| Logs de `backup-data` | 0 llamadas en las últimas 24 h. La API no permite mirar más atrás, así que **no se puede descartar acceso anterior**; si se quiere certeza hay que revisar el historial en el panel de Supabase o rotar los tokens de Microsoft por precaución. |
| Lectura pública de `agent_registry`, `agent_tasks`, `agent_activity_logs` | La usa la VM de agentes (`python-httpx`, cada 30 min, con la clave `anon`). **No se cierra** hasta que la VM lea con `service_role`. El front ya las lee con sesión de usuario. → **Cerrado el 2026-10-12** (ver 5.10): la VM era `kawiil-agents` y ya usa una clave de servicio propia. |
| Avisos restantes de Supabase (9 tipos) | `anon`/`authenticated` con funciones SECURITY DEFINER ejecutables (las 5 de `anon` son intencionales), tablas visibles en GraphQL, `search_path` mutable, `pg_trgm` en `public`, una tabla con RLS sin políticas, OTP largo y contraseñas filtradas sin proteger. |

**Hallazgos nuevos:**

| # | Sev | Hallazgo | Estado |
|---|---|---|---|
| N1 | Alta | **La clave `service_role` se usa fuera de Supabase**, desde una red residencial/oficina en México (Cablevisión): 158 llamadas en 24 h de `Python-urllib` (lectura de `tasks`, `projects`, `clients`, `profiles` y sondeos de tablas que no existen: `pagos`, `facturas`, `cobranza`…) más 13 de la VM de agentes. Esa clave omite RLS. Puede ser herramienta propia, pero no lo puedo confirmar. | **Origen identificado y migrado** (ver 5.9): no era Cerebro sino dos servicios de la Mac de Leo (`louis_healthcheck.py` y `kawiil-agents`). Ambos usan ya una *secret key* dedicada; desde las 03:13 UTC no llega ninguna llamada con la firma de la clave legacy. Pendiente (opcional): rotar o desactivar la clave legacy y limpiar sus copias en texto plano. |
| N2 | Media | El `state` de OAuth de Slack (`slack-user-callback`) y el de Microsoft (`_shared/microsoftOAuthState.ts`) **no están firmados**: es el `userId`. Un atacante que conozca el UUID de otro usuario puede vincular su propia cuenta de Slack/Microsoft a esa persona. | **Corregido** (ver 5.7): `state` firmado con HMAC y caducidad; no requirió cambios en el front. |
| N3 | Media | `satgo-facturas`: cualquier usuario con sesión (sin rol) puede disparar la descarga SAT de **todos** los clientes de **todas** las organizaciones. Además, la función desplegada es un arranque que importa el código de `raw.githubusercontent.com` en un commit fijo (`266629df`) y esa carpeta ya no existe en `main`: el CI no la redespliega. | **Corregido** (ver 5.6): la función vuelve al repo, el disparo manual exige admin/gerente y se limita a su organización. |
| N4 | Media | `mtg-graph-webhook` aceptaba notificaciones sin `clientState` o sin el secreto configurado (insertaba en `job_queue` y `mtg_unmatched_transcripts`). Sin llamadas en 24 h y sin suscripción real todavía. | **Corregido en este PR**: falla cerrado y exige `clientState` exacto. Requiere crear el secreto `MTG_GRAPH_CLIENT_STATE` antes de activar la suscripción. |
| N5 | Baja | `esign`: la IP de la firma sale de `x-forwarded-for` (suplantable; mejor `cf-connecting-ip`); los 500 devuelven `e.message`; `fetchRemotePdf` sigue redirecciones; no hay límite de intentos; `decline` no condiciona el estado. El resto está bien: token de 244 bits, validación de organización, firma atómica, orden secuencial, solo PDF/PNG con tope de tamaño. | **Corregido** (ver 5.8), salvo el límite de intentos. |

**Acciones solo del panel de Supabase (no se pueden hacer desde aquí):** Auth → activar protección de contraseñas filtradas; Auth → bajar la expiración de OTP a ≤ 3600 s. La CSP sigue en solo reporte porque no hay colector de reportes que diga qué rompería.

## 5.5 Estado de la Fase 2: conexión de solo lectura (2026-10-12)

> **RETIRADA (2026-10-12).** Esta fase hacía que Kawiil llamara al puente de **Kit-to-Drive**. Esa conexión se descartó: Kit-to-Drive es de otro proyecto y la seguridad de Kawiil OS se plantea con MATI Admin y MATI API (ver 5.12). Se quitaron la Edge Function `integraciones-gateway`, la tarjeta «MATI / Kit-to-Drive» de Configuración → Integraciones y el diálogo de tickets. Se conservan `_shared/security.ts` y la tabla `integration_audit`, que sirven de base para 5.12. Lo que sigue describe lo que se construyó, como historial.

**Construido (en este PR, sin secretos configurados → inactivo hasta que se activen):**

| Pieza | Qué hace |
|---|---|
| `supabase/migrations/20261012130000_integration_audit.sql` | Tabla `integration_audit` **append-only** (trigger que bloquea UPDATE/DELETE incluso a `service_role`). RLS: solo un `transformador` de la misma organización lee. `anon`/`authenticated` sin permisos de escritura. |
| `supabase/functions/_shared/security.ts` | CORS con lista de orígenes (no `*`), `authenticate`, límite de ritmo, bitácora, HMAC-SHA256, enmascarado y lista blanca de campos (`pickFields`). |
| `supabase/functions/integraciones-gateway` | `verify_jwt = true` + rol `transformador`; 30 solicitudes/60 s por usuario (falla cerrado si no puede contar); **lista cerrada** de acciones (`status`, `users`, `modules`, `tickets`) con parámetros validados; credencial de servicio propia; firma HMAC opcional; solo devuelve campos permitidos y con el correo enmascarado; errores del puente no se reenvían; cada intento a la bitácora sin cuerpos ni secretos. |
| `MatiConnectionCard` en Configuración → Integraciones | Estado de la conexión y tablas de usuarios, módulos y tickets. Datos solo en memoria (React Query sin persistencia, 60 s). Si faltan secretos, dice cuáles. |

**Probado:** tipos (Deno y `tsc`), 11 pruebas de las utilidades (incluye el vector RFC 4231 de HMAC), 31 del flujo completo del gateway con Supabase y puente simulados (sin sesión, sin rol, sin configurar, acciones fuera de lista incluido `__proto__`, parámetros inválidos, campos sensibles que no salen, firma, 502/504, CORS, límite de ritmo), 3 de la tarjeta y, del SQL, 13 comprobaciones en un Postgres real (PGlite) tras ejecutarlo dos veces: idempotencia, RLS por organización, grants y append-only. **No probado contra producción ni contra un MATI real**: el entorno no puede ejecutar DDL ni llamar a Supabase por HTTP; lo aplicará el CI.

**Para activarlo hacen falta tres secretos en Supabase → Edge Functions:** `MATI_GATEWAY_URL` (URL del puente `mati-admin-bridge`), `MATI_GATEWAY_TOKEN` (≥ 32 caracteres) y, opcional, `MATI_GATEWAY_HMAC_KEY`.

**Limitaciones que dependen de MATI / Kit-to-Drive (no del código de Kawiil):**
1. `mati-api` solo acepta sesión de admin de MATI; no existe credencial de máquina. Por eso el gateway apunta al **puente** (`mati-admin-bridge`), cuyas rutas son `/app/status`, `/users`, `/modules` y `/tickets`.
2. Ese puente hoy acepta **un solo secreto compartido** (el mismo que usa `mati-api`). Una credencial *dedicada a Kawiil* requiere que `kit-to-drive-web` (no disponible para mí) acepte un segundo secreto. **Mientras tanto, configurar `MATI_GATEWAY_TOKEN` con el secreto actual reutiliza la credencial de MATI**, lo que el plan quería evitar: es una decisión que debe tomarse a conciencia.
3. La firma HMAC solo protege cuando el puente la verifique (hallazgo M7 del informe de MATI); hasta entonces es inofensiva pero no añade seguridad.
4. Las listas de campos permitidos se basan en los esquemas que se ven en `mati-api` (`routes/admin-kit-to-drive.ts`); los nombres reales que devuelve el puente podrían diferir (una columna ausente simplemente no se muestra). Se ajustan en `ACTIONS` del gateway.

**Siguiente (Fase 3, escritura controlada):** acciones con confirmación y doble registro; solo tras tener credencial dedicada y HMAC verificado en el puente. → Primera ola construida y apagada: ver 5.11.

## 5.6 Corrección de N3: `satgo-facturas` (2026-10-12)

**Problema:** la función en producción era un arranque de una línea que importaba su código de `raw.githubusercontent.com` en el commit `266629df`, de una rama que nunca se fusionó a `main`. Por eso `main` no tenía ni la función ni dos de sus dependencias, y el CI no podía redesplegarla. Además, el disparo manual aceptaba a **cualquier usuario con sesión** y recorría **los clientes de todas las organizaciones**.

**Cambio:**
- Se restaura al repo el código exacto que corre hoy (commit `266629df`): `satgo-facturas/index.ts`, `_shared/satgoCfdiEnrich.ts`, `_shared/portal/{cfdiXml,fiscalMirror,publishInvoiceToOs,systemAuth,validate}.ts` y 4 catálogos JSON. `_shared/satgoFielClient.ts` pasa a la versión del commit, que es un superconjunto puro del de `main` (+238 líneas, 0 eliminadas), así que `satgo-query` y `satgo-monthly` no cambian de comportamiento.
- Disparo manual: solo `is_admin_or_manager` y limitado a la organización del usuario (también con `clientId`). El cron (`x-cron-secret`) sigue recorriendo todas las organizaciones, sin cambios.
- `config.toml`: `[functions.satgo-facturas] verify_jwt = false`. Es obligatorio: el cron solo manda `x-cron-secret`, sin JWT.
- Al desplegar por CI, el arranque que importaba de GitHub se reemplaza por el código empaquetado del repo.

**Probado:** 11 pruebas con Supabase simulado (sin credenciales, secreto incorrecto, JWT inválido, usuario sin rol, admin sin organización, admin de su organización, cliente de otra organización, cron intacto). Contra el código original, 5 de esas pruebas fallan (el problema se reproduce); con el arreglo pasan las 11. Tipos: el archivo tiene 14 errores de tipos de supabase-js **idénticos antes y después** (preexistentes; el despliegue no verifica tipos).

**No probado:** contra producción ni contra SATgo reales. Ninguna pantalla llama hoy a esta función; solo el cron.

## 5.7 Corrección de N2: `state` de OAuth firmado (2026-10-12)

**Problema:** en Slack, Microsoft, Outlook vinculado y Google el `state` del flujo OAuth era el UUID del usuario (en Microsoft, un JSON en base64 sin firma). Quien conociera el UUID de otra persona podía iniciar el flujo con ese `state` y vincular **su propia** cuenta externa a la cuenta Kawiil de esa persona.

**Cambio:**
- Nuevo `_shared/oauthState.ts`: `state = v1.<payload>.<HMAC-SHA256>`; el payload lleva el proveedor, la caducidad (10 min) y un nonce. Solo las funciones `*-auth`, que exigen sesión, emiten un `state` válido y solo para el usuario autenticado. Un `state` de un proveedor no sirve en otro.
- Clave: `OAUTH_STATE_SECRET` (≥ 32 caracteres) si existe; si no, se deriva de `SUPABASE_SERVICE_ROLE_KEY` (que ya tienen todas las funciones, sin exponerla). **No hace falta crear ningún secreto nuevo.**
- Los cuatro callbacks rechazan el `state` ausente, falsificado, caducado o de otro proveedor **antes** de llamar al proveedor. Ya no se acepta el UUID "legado" en Microsoft.
- No hubo que tocar el front: el `state` lo genera el servidor.

**Hallazgo adicional corregido:** `google-callback` y `outlook-account-callback` insertaban el parámetro `error` de la URL sin escapar dentro de un `<script>` y del HTML (XSS reflejado en el dominio de las funciones). Se escapa el HTML y se usa `JSON.stringify` con `<` escapado. Slack y Microsoft ya escapaban el HTML, pero su `JSON.stringify` dentro del script tampoco escapaba `<` (un `</script>` rompía el bloque); también se corrigió.

**Probado:** 47 comprobaciones con Deno: firma y verificación, UUID crudo, JSON sin firma, firma alterada, payload cambiado a otro usuario, caducidad, proveedor cruzado, cambio de clave; los 4 callbacks reales (falsificado/ausente → no llaman al proveedor; válido → continúa; otro proveedor → rechazado); y XSS ejecutando los `<script>` de la respuesta con un `alert` espía (4 cargas × 4 callbacks). La primera corrida detectó que `microsoft-callback` seguía vulnerable; se corrigió. Tipos: las 10 funciones y módulos compilan sin errores con `deno check`.

**Verificado en producción (2026-10-12):** los cuatro callbacks rechazan un `state` falso sin llegar al proveedor (Slack, Outlook y Google responden 400; Microsoft muestra su página de error con HTTP 200, una inconsistencia menor de estado HTTP, no de seguridad). La conexión real de **Slack** funcionó de extremo a extremo: `slack-user-auth` emitió el `state` firmado y `slack-user-callback` lo aceptó y vinculó la cuenta. **No probado:** la ruta de éxito de Google, Outlook y Microsoft con cuentas nuevas (las cuentas ya conectadas no se ven afectadas; si una reconexión falla, revisar esas funciones).

**Efecto al desplegar:** los flujos de conexión que estén a medias en ese momento (menos de unos segundos) fallarán y se repiten. Los `state` en vuelo no sobreviven al cambio, por diseño.

**Límite conocido (no resuelto):** el `state` no va atado al navegador de quien inicia el flujo. Un usuario autenticado podría pedir un `state` para su propia cuenta y convencer a otra persona de completar el consentimiento; lo mitiga la pantalla de consentimiento del proveedor. Cerrarlo requiere una cookie de sesión atada al flujo.

## 5.8 Corrección de N5: endurecimiento de `esign` (2026-10-12)

**Cambios en `supabase/functions/esign/index.ts`:**
- **IP de la firma:** ahora sale de `cf-connecting-ip`, luego `x-real-ip` y, si no, del **último** salto de `x-forwarded-for`. Antes se tomaba el primer valor, que el propio firmante podía escribir, y esa IP se estampa en la hoja de firmas como evidencia. Los valores con formato inválido se descartan.
- **Descarga de PDF remoto (`fetchRemotePdf`):** las redirecciones se siguen a mano (máx. 3) y **cada salto se valida** contra la lista blanca (Dropbox, `dropboxusercontent.com`, `supabase.co`); antes `redirect: "follow"` permitía terminar en cualquier host. El tope de 15 MB se aplica por `Content-Length` y **durante la lectura** del cuerpo, no después de cargarlo entero en memoria.
- **`decline` atómico:** el `UPDATE` exige `status = 'pending'` y responde 409 si no cambió nada. Antes, un firmante que ya había firmado (o una carrera) podía quedar marcado como «rechazado» y sobrescribir su firma.
- **Errores 500:** el mensaje interno solo va a los logs; el cliente recibe «Error interno. Intenta de nuevo.».

**Probado (Deno, Supabase y red simulados):** 4 comprobaciones de la IP (se extrae la función real del archivo), 500 genérico, `decline` (ya firmó, UPDATE condicionado, carrera simulada), y la descarga (host/protocolo no permitidos, redirección a host externo, Dropbox→dropboxusercontent legítimo, redirección relativa, bucle de redirecciones, `Content-Length` > 15 MB, cuerpo sin cabecera > 15 MB que se corta a los ~17 MB, descarga normal, archivo que no es PDF). Contra el código original fallan las que miden el defecto (500 con detalle, `decline` no atómico y sobrescritura, tope de tamaño). Tipos: los mismos 2 errores de `deno check` antes y después (preexistentes: `notified_at` no está en el tipo `SignerRow`, y un `Uint8Array`/`BufferSource`).

**No probado:** firmas ni descargas reales con Dropbox o Supabase. Riesgo a vigilar: si Dropbox redirigiera a un dominio fuera de la lista (hoy usa `dropboxusercontent.com`), esa descarga se rechazaría con «Origen de archivo no permitido»; en ese caso se agrega el dominio a `ALLOWED_FILE_HOSTS`.

**Sigue pendiente de N5:** límite de intentos sobre las acciones por token (el token tiene 244 bits, así que el riesgo de adivinarlo es despreciable; el límite solo evitaría abuso de cómputo/correos).

## 5.9 Cierre de N1: la clave `service_role` fuera de Supabase (2026-10-12)

**Qué era.** Las 158 llamadas de `Python-urllib/3.9` y las de `python-httpx` con la clave legacy `service_role` (emitida en agosto de 2025, válida hasta 2070, firma `4PwMn5`) salían de la IP de la oficina/casa de Leo (Cablevisión, CDMX), la misma desde la que entra su Mac. **No era Cerebro** (Cerebro corre en `louis-prod`, Hetzner, y no llamó a Supabase con esa clave en 24 h). Eran dos servicios de la Mac, que cargan el mismo archivo `~/.openclaw/credentials/kawiil-agents.env`:

| Servicio | Qué hace | Qué necesita |
|---|---|---|
| `louis_healthcheck.py` (LaunchAgent, cada 30 min, `/usr/bin/python3` 3.9) | Comprueba que Kawiil Central responde: lee el esquema (`/rest/v1/`) y 1 fila de `projects`, `clients`, `tasks`, más sondeos de tablas que no existen | Solo disponibilidad; no necesita acceso total |
| `kawiil-agents` (FastAPI en `127.0.0.1:8000`, `python-httpx`) | Lee y escribe `agent_registry`, `agent_tasks`, `agent_activity_logs`, `agent_memories`, `ai_task_events`, `legal_tesis*`, `legal_dof_*` y descarga adjuntos de Storage | Acceso de servidor completo |

**Qué se hizo.** Se creó una *secret key* dedicada (`kawiil-agents-mac`, mismo acceso, revocable por separado, sin firma JWT en los logs) y se cambió en `kawiil-agents.env`. `supabase-py` 2.10.0 rechazaba el formato `sb_secret_…` (`Invalid API key`), así que se actualizó a 2.32.0 antes del cambio (respaldo de versiones en `~/kawiil-agents-freeze-antes.txt`).

**Verificación.** A las 03:13:54 UTC, al reiniciar `kawiil-agents`, la llamada llegó sin firma JWT (clave nueva) y registró 25 agentes. Desde las 03:13 UTC no llega **ninguna** llamada con la firma `4PwMn5` de ninguna IP; el healthcheck ya usa la clave nueva (22 llamadas entre las 03:22 y las 03:53 UTC). En las últimas 24 h, los consumidores de esa firma fueron la Mac (tres IPs de Cablevisión) y **dos llamadas sin identificar** de `python-requests/2.33.0` a `/auth/v1/health` desde una IP de AWS (`35.161.89.114`, 01:22 UTC). Por la hora y el endpoint parecen una herramienta de diagnóstico, pero no se pudo verificar; si vuelven a aparecer tras rotar la clave legacy, hay que identificarlas.

**Pendiente (opcional, sin urgencia):**
- **Rotar o desactivar la clave legacy.** Ya no hay un consumidor desconocido, pero la clave estuvo en texto plano en la Mac y en copias de `louis-prod` (`/opt/openclaw/.env.bak*` y `.respaldo-*`). Rotarla implica tocar también la clave `anon` (que va en el JavaScript del front) y las claves que Supabase inyecta en las Edge Functions, así que se hace como mantenimiento planeado, con inventario previo y no antes de decidirlo.
- **Limpiar las copias antiguas en `louis-prod`** (y revisar si `donna_core.py`, `nexo_*.py` y `setup-kawiil-central-creds.sh` usan realmente esa clave).
- **Healthcheck con credencial mínima:** hoy usa la clave de servicio nueva; le bastaría la `anon` o una dedicada.

## 5.10 Cierre de la lectura anónima de las tablas de agentes (2026-10-12)

**Problema.** Las políticas `anon_read_registry`, `anon_read_tasks` y `anon_read_logs` eran SELECT `USING (true)` para el rol `public`: cualquiera con la clave `anon` (que va en el JavaScript del sitio) leía las tareas y resultados de los agentes, el catálogo de agentes y sus logs. `auth_insert_tasks` además dejaba a cualquier usuario con sesión insertar tareas con cualquier agente.

**Evidencia previa.** En 24 h hubo cero lecturas con rol `anon` sobre esas tablas; solo `kawiil-agents` (clave de servicio) y el front con sesión de usuario. Ni el front ni las funciones del repo insertan en `agent_tasks`: `dispatch-to-agent` reenvía a la VM, que escribe con clave de servicio. Los datos viven en la organización global `00000000-…-0001` y los usuarios en `a0000000-…-0001`, por lo que **no se puede filtrar por organización**.

**Cambio (PR #385, migración `20261012150000_agent_tables_cerrar_lectura_anonima.sql`).** Se eliminan las tres lecturas abiertas y `auth_insert_tasks`; se crean lecturas solo para `authenticated`; se revocan los privilegios de `anon` sobre las tres tablas. `service_role` no cambia (se salta RLS). Probado en una base temporal (antes: `anon` leía y los usuarios insertaban; después: `anon` recibe `permission denied`, los usuarios leen y no insertan, `service_role` sigue igual; segunda ejecución sin errores).

**Verificado en producción.** Migración registrada; políticas nuevas presentes, `anon_read_*` y `auth_insert_tasks` ausentes, 0 privilegios de `anon` sobre las tres tablas.

**No probado:** la app con una sesión real (sección de agentes y tarjeta de tareas del chat). Si algo se ve vacío, revisar primero estas políticas.

**Siguiente paso:** acotar la lectura de tareas y logs por `created_by` o rol (hoy cualquier usuario con sesión lee todo). Antes hay que ver cómo se comparten las tareas en el chat para no romper vistas compartidas.

## 5.11 Fase 3: escrituras de tickets hacia Kit-to-Drive (2026-10-12) — RETIRADA

> **RETIRADA (2026-10-12).** Se descartó la conexión con Kit-to-Drive (ver 5.12): las escrituras de tickets, el diálogo y la firma saliente se quitaron junto con el gateway. Lo que sigue queda como historial y para reutilizar las ideas (lista cerrada de acciones, límite de ritmo, doble registro, firma con el cuerpo, confirmación antes de escribir) en el sentido contrario: MATI Admin controlando Kawiil.

**Qué se decidió.** Primera ola con solo dos acciones sobre tickets de soporte: `ticket_update` (estado y prioridad) y `ticket_message` (responder). **Fuera de la lista cerrada del gateway, a propósito:** crear o editar usuarios (incluido su nivel), resetear contraseñas, activar o desactivar usuarios, cambiar la configuración y activar o desactivar módulos. El puente de MATI sí las expone; si se quieren más adelante, se añaden una a una con su validación y sus pruebas.

**Cómo queda apagada.** Las escrituras responden `403 writes_disabled` y **no llaman a MATI** mientras `MATI_GATEWAY_WRITES` no valga exactamente `on`. Aun encendida, exigen `MATI_GATEWAY_HMAC_KEY` (sin ella responden 503 y tampoco llaman). La pantalla solo muestra «Gestionar» cuando el gateway informa `writes_enabled`.

**Controles de cada escritura.**
- Sesión válida y rol `transformador`; el servidor valida de nuevo aunque la pantalla no muestre el botón.
- Validación estricta, sin claves extra: id de ticket en formato UUID (no hay forma de construir otra ruta), estado y prioridad de listas cerradas, mensaje de 1 a 5000 caracteres sin NUL. El autor del mensaje lo fija el servidor (`Soporte (Kawiil Central)`); el cliente no puede elegirlo.
- Límite propio de **10 escrituras por minuto por usuario** (las lecturas no lo consumen) y bloqueo de **mensajes duplicados** (mismo usuario, ticket y texto) durante 60 s. Si no se puede consultar la bitácora, **falla cerrado**.
- Confirmación en pantalla que muestra el antes y el después, o el texto exacto del mensaje, y avisa que el cambio se aplica en MATI.
- **Doble registro:** la bitácora append-only de Kawiil (`integration_audit`: quién, qué ticket, qué valores; del mensaje solo el largo y una huella corta, nunca el texto) y el actor `x-mati-actor: kawiil:<correo>` que viaja al puente para su propia bitácora.
- Respuesta con lista blanca de campos; los errores del puente no se reenvían (solo se distinguen «no encontrado» y «MATI no aceptó el cambio»).
- **Firma HMAC con el cuerpo:** `HMAC-SHA256(clave, "<ts>.<nonce>.<MÉTODO>.<ruta?query>.<sha256(cuerpo)>")`, en las cabeceras `x-kawiil-timestamp`, `x-kawiil-nonce` y `x-kawiil-signature`. Las lecturas siguen firmándose sin el último segmento. Formato detallado para MATI en el anexo del informe de MATI.

**Probado.** Gateway (Deno, Supabase y puente simulados): 55 comprobaciones de escritura (bandera, firma, autorización, validación con 32 entradas inválidas, duplicados, límites, errores del puente, que la bitácora no guarde texto, que la firma cambie si cambia el cuerpo) más las 31 de lectura, que siguen pasando tras el refactor. Se comprobó que las pruebas **fallan** al introducir cinco defectos a propósito (quitar la bandera, contar lecturas en el cupo de escrituras, guardar el texto en la bitácora, dejar que el cliente elija el autor y firmar sin el cuerpo). Front: 14 pruebas de la tarjeta y el diálogo (incluidas dos mutaciones detectadas: enviar sin recortar y enviar sin confirmar). Tipos: `deno check` limpio en el gateway.

**No probado.** Contra un MATI real: ni la forma de las respuestas del puente a `PATCH /tickets/:id` y `POST /tickets/:id/messages`, ni que el puente acepte `autor_nombre`. Tampoco el diálogo en un navegador real.

**Condiciones para encenderla (`MATI_GATEWAY_WRITES=on`), todas pendientes del proyecto MATI:**
1. Una **credencial dedicada a Kawiil** en el puente (hoy hay un solo secreto compartido; configurarlo como `MATI_GATEWAY_TOKEN` daría a Kawiil las mismas escrituras que un administrador de MATI).
2. El puente **verifica la firma** (ventana de ±5 min y nonce de un solo uso) y rechaza lo que no coincide (hallazgo M7).
3. El puente **registra el actor** que recibe en su propia bitácora.
4. Una prueba con un ticket real en un entorno de pruebas de MATI.

**Siguiente.** Cuando se cumplan las condiciones, encender en un entorno de prueba, ejecutar un cambio y un mensaje reales, y comprobar los dos registros. Una segunda ola (activar o desactivar usuarios o módulos) requiere decisión expresa.

## 5.12 Replanteamiento: MATI Admin controla Kawiil (2026-10-12)

**Decisión.** No hay ninguna conexión con el sistema de Kit-to-Drive. La relación es la inversa de la que se había construido: **MATI Admin (con MATI API) tiene el control de la aplicación de Kawiil Central y de Kawiil OS**, como un panel de seguridad, y esa aplicación queda configurada de forma segura desde ahí. La seguridad (back, middle y front) cubre a la plataforma MATI y a Kawiil OS.

**Se retiró** el gateway hacia Kit-to-Drive, la tarjeta de Integraciones y las escrituras de tickets (PR de limpieza). La función ya desplegada `integraciones-gateway` sigue existiendo en Supabase, inactiva (sin secretos, solo responde «no configurado»): hay que **borrarla a mano** (`supabase functions delete integraciones-gateway --project-ref qppfampapbxdgednkofc` o desde el panel), porque el CI no elimina funciones.

**Se conserva** `_shared/security.ts` (CORS por lista, autenticación y rol, límite de ritmo, bitácora, HMAC, enmascarado y lista blanca de campos) y la tabla `integration_audit` (append-only): son la base natural de un plano de control.

**Diseño y estado.** Se construye por olas, siempre con Kawiil como servidor y MATI API como cliente (sin tocar el código de MATI ni de Kit-to-Drive):

- **Ola 1 — solo lectura (construida, en PR).** Edge Function `seguridad-control` (POST, lista cerrada de acciones: `status`, `snapshot`, `posture`, `users`, `activity`, `secrets`, `audit`), tres funciones SQL de lectura (`security_posture`, `security_users_snapshot`, `security_auth_activity`; solo `service_role`) y la tabla `control_nonces`. Autenticación en dos capas: credencial propia + firma HMAC con hora (±300 s) y nonce de un solo uso; rotación con `*_PREVIOUS`; actor siempre con prefijo `mati:`; bitácora append-only en `integration_audit`; 60 consultas/min; sin CORS; 503 genérico si no está configurada. Contrato y cliente de ejemplo para MATI: `docs/seguridad/contrato-control-mati-admin.md`. Pruebas: 20 casos Deno con doble de Supabase y 8 mutaciones detectadas; SQL validado en PGlite.
- **Ola 2 — escrituras (sin construir, requiere decisión).** Bloquear/reactivar usuarios, cerrar sesiones, cambiar ajustes de seguridad. Cada una con confirmación en dos pasos, motivo obligatorio y registro antes y después.
- **Activación.** Hasta que se carguen `SEGURIDAD_CONTROL_TOKEN` y `SEGURIDAD_CONTROL_HMAC_KEY` en Supabase la función responde 503 y no expone nada.

## 6. Decisiones que necesito de ti

1. **¿Qué roles de Kawiil pueden ver datos de Kit-to-Drive/MATI?** (propongo solo dirección y administración al inicio).
2. **¿Qué datos mostramos primero?** (propongo estado, usuarios activos, módulos y tickets: lo que el puente ya expone).
3. **¿Permito empezar por la Fase 0?** Toca configuración en producción (`config.toml` y despliegue de funciones), así que no la ejecuto sin tu confirmación.
4. **¿Acceso a `kit-to-drive-web` y `kit-to-drive-api`?** Sin ellos no puedo revisar la Edge Function del puente ni la lista blanca.
