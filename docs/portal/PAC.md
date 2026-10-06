# PAC y Facturapi — frontera actualizada (Polo · Facturación)

## Decisión

- **Ingresos / Egresos**: archivo SatGo publicado por central (espejo). OS no llama SatGo/Moffin.
- **Facturación**: emitir facturas nuevas, solicitar desde recibos y **generar complementos de pago** con **Facturapi** ([docs](https://docs.facturapi.io)). No es el archivo SatGo.

## Dónde viven las llaves (Fase 1)

| Pieza | Dónde |
|---|---|
| `FACTURAPI_SECRET_KEY` / org | Preferible **central** (Edge Secrets) + tabla `facturapi_client_orgs` |
| UX guiada | Kawiil OS (`/facturas`, `/facturas/nueva`, `/facturas/complemento`) |
| Emisor | `PORTAL_EMISOR=facturapi` → `EmisorFacturapi` en `portal-api` |
| Host central opcional | Edge `facturapi-api` (`invoice.create`, `payment.create`, `payment.summary`) |

No poner e.firma/CIEC/SatGo ni llaves live de Facturapi en el build del navegador.

## Operaciones portal-api

| Op | Rol |
|---|---|
| `facturas.validar` / `facturas.crear` | Ingreso CFDI 4.0 |
| `facturas.complemento_pago` | CFDI tipo P (pago) |
| `catalogos.buscar` | Suggest `ClaveProdServ` / unidad |
| `plantillas.*` | Facturas y conceptos frecuentes + `internal_id` |

Con `PORTAL_EMISOR=facturapi` y key configurada, la emisión de Facturación puede operar aunque `PORTAL_MIRROR_READ_ONLY=true` (el espejo SatGo sigue bloqueado para carga XML).

## Catálogos

Tabla OS `sat_catalog_entries` + RPC `portal_sat_catalog_suggest`. Semilla parcial; carga completa: `tools/portal/seed-sat-catalogs.md`.
