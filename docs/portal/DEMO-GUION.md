# Guion de demostración — espejo del servicio Kawiil (fase Corte 4)

Alineado a la «Guía de la primera etapa» del portal, **recortado a la fase espejo del servicio**: solo lectura de lo que Kawiil ya publicó desde central. El bloque fiscal es lo visible hoy; **no** se demuestra RH ni emisión.

Duración orientativa: 12–15 minutos. Cuenta: `demo.cliente@kawiil-demo.invalid` sobre la empresa **DEMO Espejo Fiscal SA de CV** (nombre de la razón social sembrada; el producto se presenta como espejo del servicio).

Antes de empezar: reinicio exacto (`docs/portal/DEMO.md`) y build con `VITE_PORTAL_DEMO_MODE=true`. Debe verse el banner *Entorno de demostración · DEMO — sin validez fiscal* (marca correcta para CFDI sintéticos).

---

## 0. Marco (1 min)

- «Esto es el **espejo del servicio Kawiil**: el cliente ve, en solo lectura, lo que el equipo ya trabaja y publica en central.»
- «Hoy el primer bloque disponible es el fiscal (facturas, IVA, constancia, declaraciones, alertas). RH y emisión son fase 2.»
- «Ningún CFDI demo tiene validez fiscal. Toda factura lleva la marca **DEMO — sin validez fiscal**.»
- «En esta fase el cliente **no** carga XML, **no** emite y **no** usa RH.»

## 1. Acceso (1 min)

1. Abrir el dominio demo del portal.
2. En login, ver el panel: **Espejo del servicio**.
3. Ingresar con la cuenta demo.
4. Confirmar banner DEMO y que no hay entradas de Tickets ni «Crear factura» en la navegación.

## 2. Resumen del servicio / bloque fiscal (3 min)

1. Ir a **Inicio** (título: **Resumen del servicio**).
2. Periodo **septiembre 2026** (semilla).
3. Señalar la sección **Situación fiscal del periodo** y luego:
   - Ingresos y gastos del mes (cifras publicadas).
   - IVA estimado / trasladado / acreditable.
   - Retenciones IVA e ISR.
   - Indicador de **calidad media** (hay una factura solo metadatos).
   - Leyenda de demostración / gestión.
4. Mencionar la regla PUE/PPD visible (`iva_basis` = flujo de efectivo en la semilla).

## 3. Facturas emitidas y recibidas (4 min)

1. Ir a **Facturas**.
2. Mostrar lista: emitida PUE, recibida con retenciones, recibida solo metadatos, emitida PPD.
3. Abrir la emitida completa → conceptos, impuestos, marca **DEMO — sin validez fiscal**.
4. Abrir la de solo metadatos → sin conceptos; flag de atención.
5. Abrir la PPD → pago vinculado parcial.
6. Confirmar que **no** hay «Cargar XML» ni «Nueva factura».

## 4. Constancia, opinión y declaraciones (2 min)

1. Ir a **Documentos**.
2. Mostrar constancia de situación fiscal con fecha de obtención.
3. Mostrar opinión 32-D **positiva** con fecha de obtención.
4. Mostrar declaración provisional de agosto 2026.
5. Recordar: en producción estos PDF se publican desde central (`sat_document.publish` / `declaration.publish`); el demo solo muestra el resultado.

## 5. Alertas EFOS / cancelaciones y notificación SAT (2 min)

1. Ir a **Alertas**.
2. Mostrar alerta **EFOS** (crítica) ligada a un RFC de proveedor demo.
3. Mostrar alerta de **cancelación**.
4. Mostrar la notificación SAT sintética del buzón.

## 6. Cierre (1 min)

- Recapitular: espejo del servicio (solo lectura), bloque fiscal primero, datos ficticios, marca DEMO en CFDI, reinicio exacto en un comando.
- Fuera de alcance hoy: emitir, cargar XML, tickets, RH, e.firma.
- Preguntas.

---

## Fuera de guion (no demostrar en Corte 4)

| Tema de la guía completa | Estado en este guion |
|---|---|
| Registro / activación básica | Omitido (cuenta ya sembrada) |
| Carga de CSD | Omitido (espejo) |
| Crear factura / EmisorPrueba | Omitido (espejo; `403 espejo_solo_lectura`) |
| Tickets / foto | Omitido |
| RH (asistencia, empleados) | Omitido (`rh_enabled=false`) |
| Baja y resguardo reales | Solo mencionar política; no ejecutar destrucción en demo compartido sin reinicio inmediato |

## Después de cada sesión

```bash
PORTAL_DEMO_ALLOW_RESET=1 DATABASE_URL='…' npm run portal:demo-reset
```
