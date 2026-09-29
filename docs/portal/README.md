# Portal del cliente de Kawiil OS

Cara nueva de `kawiil-central` para los clientes de Kawiil: tablero de gasto, facturas emitidas y recibidas, creación de facturas de ingreso, documentos publicados, tickets y mensajes con el equipo. **No guarda datos propios**: lee y escribe en la misma base de Supabase con permisos de cliente (RLS).

| Documento | Para qué |
|---|---|
| [RECONOCIMIENTO.md](RECONOCIMIENTO.md) | Qué había en el repo y qué se decidió |
| [API.md](API.md) | Contrato v1 entre la app y central |
| [RUNBOOK.md](RUNBOOK.md) | Migraciones, variables, pasos manuales, cron |
| [TIENDAS.md](TIENDAS.md) | Lo que falta para App Store y Google Play |
| [CONSERVACION.md](CONSERVACION.md) | Política de baja, resguardo (5 o 10 años) y eliminación de datos, fijada por Polo |

## Cómo está armado

```
portal/index.html, portal/public/     entrada y PWA (manifest, sw.js solo en línea, iconos)
vite.config.portal.ts                 build SEPARADO → dist-portal/
src/portal/                           app del portal (no importa nada del back-office; lo vigila boundary.test.ts)
supabase/functions/_shared/portal/    lógica pura compartida por Edge, portal y pruebas
    dropboxFilter.ts, dropboxSync.ts  qué entra de Dropbox y el motor de sincronización
    cfdiXml.ts                        lectura y validación de CFDI
    emission/                         adaptador del emisor: EmisorPrueba y EmisorPacPlantilla
    validate.ts, catalogs/            RFC, CP y catálogos del SAT (la matriz régimen × uso está vacía a propósito)
    tickets.ts, csd.ts, openclaw.ts   ventanas de comercios, vista pública del CSD, salida al modelo
supabase/functions/portal-api/        API v1 (Storage, Auth admin, cifrado, emisor, XML)
supabase/functions/portal-notify/     avisos a Slack (sin contenido) y correos al cliente
supabase/functions/portal-dropbox-sync/  Dropbox → bucket privado `portal`
supabase/migrations/2026092911*_portal_*.sql, 2026092912*_portal_*.sql   13 migraciones; rollback en migrations/2026-09-28_portal_*.rollback.sql
src/pages/portal-admin/PortalClientes.tsx       central → «Portal de clientes» (/portal-clientes), incl. «Baja y resguardo»
src/pages/portal-admin/BandejaClientes.tsx      central → Comunicación → «Clientes» (/comunicacion/clientes)
tools/portal/build-sat-catalogs.mjs   genera los catálogos del SAT desde el catCFDI oficial
supabase/tests/portal/                pruebas de base (SQL) y de API (PostgREST)
```

## Correrlo

```bash
export NVM_DIR="/home/ubuntu/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"   # según AGENTS.md
npm install
npm run dev:portal        # http://localhost:8081 (usa el mismo .env que central)
npm run build:portal      # dist-portal/
npm run dev               # central en :8080 → /portal-clientes y /comunicacion/clientes
```
Sin cuentas del portal en Supabase solo se puede ver el acceso y el registro. Para una cuenta de prueba: central → Portal de clientes → Cuentas → «Invitar directamente» con un cliente **sintético**.

## Probarlo

```bash
npm run test              # incluye src/test/portal/* (Dropbox con carpeta local, CFDI, emisión, tickets, catálogos, frontera del build, openclaw)

# Base (Postgres local ≥15 con superusuario; el stub imita Auth/Storage/Vault/cron de Supabase):
PGHOST=/ruta/socket PGPORT=5432 PGUSER=postgres npm run test:portal-db
#  → base vacía, rollback + reaplicación, base con datos previos, idempotencia; 207 verificaciones por corrida

# API (Postgres local + Docker con postgrest/postgrest:v12.2.3):
PGHOST=… PGPORT=… PGUSER=postgres npm run test:portal-api   # orquesta todo (bases, PostgREST en Docker, aislamiento, regresión del equipo, cerco y su negativo, B5 sin contenido en claro)
DENO=/ruta/deno npm run test:portal-edge   # funciones con verify_jwt=false sin credencial
```
Todos los datos de prueba son sintéticos (RFC ficticios, dominios `.invalid`).
