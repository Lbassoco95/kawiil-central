# PAC y Facturapi — frontera del espejo (Corte 3)

## Decisión de cumplimiento

En la fase **espejo fiscal**, Kawiil OS **no** implementa adaptadores PAC ni Facturapi. La emisión, el timbrado, la descarga masiva y la consulta al SAT con e.firma/CIEC/SatGo viven **solo en central**.

Este documento fija el contrato para no reabrir F1/F3 en OS hasta que Polo lo decida.

## Qué hace central

- Descarga y procesa CFDI (incl. Moffin / proveedores internos).
- Obtiene constancia y opinión (ruta F5 documentada en `FRONTERA-API.md`).
- Detecta alertas (EFOS, cancelaciones, 69-B) y notificaciones del SAT.
- Publica a Kawiil OS únicamente payloads firmados (`invoice.publish`, `fiscal_summary.publish`, `sat_document.publish`, `declaration.publish`, `alert.publish`, `sat_notification.publish`).

## Qué hace Kawiil OS

- Recibe, almacena con idempotencia y muestra en pantallas de solo lectura.
- Calcula o muestra el estimado de IVA/retenciones con la regla PUE/PPD (`iva_basis`) publicada por central.
- Indica calidad de datos (`complete` vs `metadata`).
- **No** llama a Facturapi, PAC real, Moffin, SatGo ni al SAT.

## Emisión futura (fuera de alcance)

Si más adelante Polo autoriza emisión desde OS:

1. El adaptador PAC/Facturapi se implementa detrás de `PORTAL_EMISOR` en **central** o en un servicio dedicado, no como SDK embebido en el navegador.
2. OS solo enviaría borradores firmados hacia central; el timbrado y las llaves CSD seguirían fuera del alcance del cliente.
3. Hasta esa decisión, `facturas.crear` / `facturas.cargar` en fase espejo responden `403 espejo_solo_lectura`.

## Secretos prohibidos en Kawiil OS

No configurar en el proyecto OS: `MOFFIN_*`, tokens Facturapi/PAC de producción, e.firma, CIEC, SatGo. Los secretos direccionales HMAC (`CENTRAL_TO_OS_SIGNING_SECRET` / `OS_TO_CENTRAL_SIGNING_SECRET`) no sustituyen credenciales fiscales.
