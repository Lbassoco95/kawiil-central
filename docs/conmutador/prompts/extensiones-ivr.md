# Conmutador — Extensiones (softphone) e IVR híbrido

Modelo elegido: **1 DID público + N extensiones internas**, atendidas por
**softphone** (app SIP en celular/compu o WebRTC de Telnyx). El menú de recepción
es **AI-first híbrido**: el agente "Kawa" conecta directo si el llamante pide a una
persona/extensión, o rutea por célula si no.

## Contratación (Telnyx)

- [ ] **DID local** (lada 55/33/81) — número público único.
- [ ] **SIP Trunk** Telnyx → ElevenLabs (agente de voz).
- [ ] **Una SIP Connection/Credential por persona** = su extensión. Cada
      colaborador registra un softphone (Zoiper/Linphone o WebRTC de Telnyx) con
      esa credencial.
- [ ] Verificación fiscal MX (Constancia de Situación Fiscal) — ver F1.

> No se necesita un DID por persona: las extensiones son internas y se alcanzan a
> través del IVR/agente. Solo compra DIDs extra si alguien debe recibir llamadas
> externas directas.

## Mapeo en la plataforma

- La extensión y su `sip_endpoint` (p. ej. `sip:kawiiler101@sip.telnyx.com`) se
  administran en la UI del Conmutador → pestaña **Extensiones** (solo G4). Se
  guardan en `public.switchboard_extensions` (extensión → `user_id` → endpoint).
- El nombre viene de `public.profiles` (no se duplica el directorio).

## Flujo de recepción (menú AI-first híbrido)

```
DID → "Kawa" contesta (aviso de grabación + saludo)
  ├─ ¿Pide persona por nombre o da/marca extensión?
  │     → sw-extension-target(extension|nombre)
  │         ├─ match            → SIP REFER directo a sip_endpoint
  │         └─ needs_disambiguation → el agente pregunta cuál y reintenta
  └─ Si no:
        → sw-classify (célula) → urgente: sw-transfer-target (G4)
                                → estándar: entrevista + sw-brief (folio)
Respaldo DTMF: el llamante puede marcar la extensión en cualquier momento.
```

## Configuración en ElevenLabs / Telnyx

- **ElevenLabs:** registrar `sw-extension-target` como tool; el agente la invoca
  cuando detecta intención de extensión/persona. El destino del SIP REFER es
  dinámico (`sip_endpoint`), nunca fijo ni expuesto al llamante.
- **Telnyx:** habilitar entrada DTMF para captura de extensión; enrutar el REFER
  hacia la SIP Connection de la persona. CLI del despacho (DID), no el del llamante.

## Privacidad

- `sip_endpoint` y el celular del G4 son **internos**: no se pronuncian ni se
  muestran al llamante. En la UI solo los ve el equipo (RLS por organización; la
  administración es exclusiva de G4).
