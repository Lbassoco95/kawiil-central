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

## 6. Decisiones que necesito de ti

1. **¿Qué roles de Kawiil pueden ver datos de Kit-to-Drive/MATI?** (propongo solo dirección y administración al inicio).
2. **¿Qué datos mostramos primero?** (propongo estado, usuarios activos, módulos y tickets: lo que el puente ya expone).
3. **¿Permito empezar por la Fase 0?** Toca configuración en producción (`config.toml` y despliegue de funciones), así que no la ejecuto sin tu confirmación.
4. **¿Acceso a `kit-to-drive-web` y `kit-to-drive-api`?** Sin ellos no puedo revisar la Edge Function del puente ni la lista blanca.
