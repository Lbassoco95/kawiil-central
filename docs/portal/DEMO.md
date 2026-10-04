# DEMO — entorno de demostración Kawiil OS

**Alcance:** producto cliente Kawiil OS (rediseño pack kawiil.mx) + espejo del servicio con datos sintéticos. **Sin IA/chat a LLM**, **sin Savio cobranza**, **sin RH**. EEFF: «Disponible desde enero 2027».

**Modelo de datos (fase 1):** kawiil-central es la fuente de verdad y **publica** hacia OS. En OS la info **ya está** como representación local (tablas portal / fixtures demo). La UI solo muestra; **no** hay pulls desde OS a SAT, Moffin, SatGo ni “ir a pedir” a central como origen.

**URL:** https://kawiil-os-demo-portal.vercel.app/ · vista diseño sin sesión: `/diseno`

Guion: [DEMO-GUION.md](DEMO-GUION.md). Arranque Polo: [ARRANQUE-POLO.md](ARRANQUE-POLO.md). Reinicio: `npm run portal:demo-reset` (cerco en `tools/portal/`).

## Checklist D1–D7 (adaptado al espejo del servicio)

| Ítem | Qué exige | Cómo se cumple en este corte |
|---|---|---|
| **D1** | Demo en proyecto/rama propio, sin credenciales reales | Proyecto **`kawiil-os-demo`** + build con `VITE_PORTAL_*` distintos de central. Turnstile de prueba. |
| **D2** | Datos sintéticos del servicio (bloque fiscal primero) | Semilla `kawiil-os/demo/seed.sql` + fixture: facturas, IVA/retenciones, constancia/opinión, declaración, notificación SAT, alertas EFOS/cancelación. |
| **D3** | Marca «DEMO — sin validez fiscal» en datos fiscales | CFDI `is_test=true`; UI + banner `VITE_PORTAL_DEMO_MODE=true`. |
| **D4** | Reinicio exacto documentado y automatizable | `npm run portal:demo-reset` / `kawiil-os:bootstrap-demo`. Prueba: `npm run test:kawiil-os-demo`. |
| **D5** | Guion sin RH ni emisión | [DEMO-GUION.md](DEMO-GUION.md). |
| **D6** | Aislamiento / cerco | Árbol `kawiil-os/` **sin** ref/JWT de central (denylist de `test:kawiil-os-db` intacta). Bootstrap y reset se niegan si el ref es central o el destino no es `kawiil-os-demo`. |
| **D7** | Conservación demo ≠ producción | [CONSERVACION.md](CONSERVACION.md) §10. |

## Cómo levantar el demo (un comando)

```bash
KAWIIL_OS_TARGET=kawiil-os-demo \
KAWIIL_OS_PROJECT_REF=<ref-demo> \
KAWIIL_OS_DB_URL='postgresql://…' \
npm run kawiil-os:bootstrap-demo
```

Detalle y pasos sin jerga: [ARRANQUE-POLO.md](ARRANQUE-POLO.md). Separación de migraciones: [PROYECTO-SEPARADO.md](PROYECTO-SEPARADO.md) §0.

## Reinicio exacto

```bash
PORTAL_DEMO_ALLOW_RESET=1 \
KAWIIL_OS_DB_URL='…' \
npm run portal:demo-reset
```

El cerco (en `tools/portal/`, no dentro de `kawiil-os/`) **siempre** rechaza el project ref de central. La denylist de `test:kawiil-os-db` no tiene excepciones para demo.

## Qué no entra

Emisión / PAC / CSD / e.firma / CIEC / SatGo / RH / carga XML / tickets / secretos de producción.
