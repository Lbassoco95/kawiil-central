# Conmutador — Integración con netelip (proveedor de telefonía)

Proveedor elegido: **netelip** (en lugar de Telnyx). netelip da el número
virtual (DID) de México, las **Líneas SIP** para los softphones (extensiones) y
la **Troncal SIP** para las llamadas salientes/transferencias. El agente de voz
sigue siendo **ElevenLabs**, y nuestras Edge Functions son webhooks HTTP
(agnósticas al proveedor) — **no cambia el código**, solo el cableado telefónico.

> Precedente: netelip documenta la integración con **Retell AI** (agente de voz
> IA por SIP). ElevenLabs se conecta con el **mismo patrón**: enrutar el número
> virtual hacia la *origination URI* SIP del agente.

## Topología

```
Cliente llama
  └─ Número virtual netelip (México)
       └─ Enrutamiento del número → origination URI SIP de ElevenLabs   [INBOUND]
            └─ Agente "Kawa" (ElevenLabs) contesta
                 ├─ tools HTTP → Edge Functions (sw-classify, sw-urgency,
                 │               sw-extension-target, sw-folio, sw-brief)
                 └─ Transferencia (SIP REFER):
                      ├─ a extensión  → Línea SIP netelip (softphone)      [interno]
                      └─ a celular G4 → PSTN vía Troncal SIP netelip       [OUTBOUND]
```

- **Extensiones (softphone)** = una **Línea SIP** de netelip por persona
  (registro con usuario/clave contra `sip-am.netelip.com`). El softphone puede ser
  la app de netelip o Zoiper/Linphone. El `sip_endpoint` que capturas en la UI
  (pestaña Extensiones) es la dirección de esa Línea SIP.
- **Salientes/transferencias al PSTN** (celular del G4) = **Troncal SIP** netelip
  (autenticación por **IP** → hay que hacer whitelist de las IPs de ElevenLabs).

## Datos de netelip

- Servidor SIP LatAm: `sip-am.netelip.com` (192.99.91.144), puerto `5060`.
  (Europa: `sip-eu.netelip.com`.)
- La **Troncal SIP** autentica **por IP** (no por usuario/clave); las **Líneas
  SIP** sí usan usuario/clave (para los softphones).
- Capacidad de troncal: 30 + 30 canales simultáneos.

## Plan de integración y verificación (por fases)

### Fase 0 — Datos a la mano
- [ ] Número virtual de México activo en netelip.
- [ ] En ElevenLabs: crear un SIP trunk (genérico) y copiar su **origination URI**
      (inbound) y los datos para salientes.

### Fase 1 — netelip solo (sin IA) — probar la base
- [ ] Crear una **Línea SIP** y registrar el softphone (app netelip o Zoiper).
- [ ] Enrutar el número virtual hacia esa Línea SIP.
- [ ] Llamar al número → **debe sonar el softphone**. ✔ telefonía base OK.

### Fase 2 — Conectar ElevenLabs (inbound)
- [ ] En ElevenLabs, dejar el agente listo con su origination URI.
- [ ] En netelip, cambiar el **enrutamiento del número virtual** para que apunte a
      esa **URI SIP externa** (la de ElevenLabs).
- [ ] Llamar al número → **debe contestar "Kawa"** con el aviso de grabación.

### Fase 3 — Tools / webhooks
- [ ] En el agente de ElevenLabs, registrar las tools apuntando a nuestras Edge
      Functions (`/functions/v1/sw-*`) con el header `x-switchboard-secret` =
      `SWITCHBOARD_WEBHOOK_SECRET` (configurado en Supabase).
- [ ] Hacer una llamada de prueba y confirmar en la UI **/conmutador → Bandeja**
      que aparece el **folio + brief**.

### Fase 4 — Salientes y transferencias (SIP REFER)
- [ ] Configurar la **Troncal SIP** saliente de netelip; **whitelistear las IPs de
      ElevenLabs** (auth por IP).
- [ ] Capturar el celular del G4 en formato **E.164** (`+52…`) en RH/`profiles`.
- [ ] Probar ruta urgente: el REFER debe conectar al celular del G4 (PSTN) en
      <15s; si no, `sw-brief` levanta la bandera roja 🔴.
- [ ] Capturar las **extensiones** (Líneas SIP) en la UI → probar transferencia
      interna por extensión/nombre (`sw-extension-target`).

### Fase 5 — Pruebas de aceptación (F6)
- [ ] Una llamada por cada una de las 5 células (ruta estándar).
- [ ] Una llamada urgente por cada criterio (audiencia<48h, detención,
      requerimiento, urgencia declarada).
- [ ] Brief entregado en <2 min; latencia de `sw-classify` <300 ms.
- [ ] Verificar que el celular del G4 y los `sip_endpoint` **nunca** se oyen al
      llamante.

## A confirmar con soporte netelip (para evitar sorpresas)
- Enrutamiento de un número virtual hacia una **origination URI SIP externa**
  (ElevenLabs) — es lo que hace la guía de Retell AI.
- **SIP REFER** soportado para transferencias, o si conviene transferencia
  atendida vía la troncal.
- IPs de ElevenLabs a **whitelistear** en la troncal saliente (auth por IP).

## Referencias
- netelip — Integración con Retell AI (mismo patrón para ElevenLabs):
  https://www.netelip.com/centro-de-ayuda/inicio-administradores/integraciones-retell-ai-con-el-servicio-de-sip-trunk-numeros-virtuales/
- netelip — Enrutar un número virtual:
  https://www.netelip.com/centro-de-ayuda/numeros-virtuales/configuracion-del-servicio/
- netelip — Configuración de Línea SIP:
  https://www.netelip.com/centro-de-ayuda/linea-sip/configuracion-del-servicio/
- netelip — SIP Trunking (configuración):
  https://www.netelip.com/centro-de-ayuda/sip-trunking/configuracion-del-servicio/
- ElevenLabs — SIP trunking:
  https://elevenlabs.io/docs/eleven-agents/phone-numbers/telephony/sip-trunking
