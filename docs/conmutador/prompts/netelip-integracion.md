# Conmutador — Integración netelip ↔ ElevenLabs (nativa)

Proveedor de telefonía: **netelip**. El número se importó a **ElevenLabs por
troncal SIP** usando la **integración nativa** ElevenLabs ↔ netelip (servidores
fijos, autenticación digest con una Línea SIP). El agente de voz es ElevenLabs y
nuestras Edge Functions son webhooks HTTP (agnósticas al proveedor) — **no cambia
el código**, solo el cableado telefónico.

## Estado actual

- **Agente:** "Kawa - Conmutador Kawiil" · `agent_id = agent_7501ky8yndc0fe98w0hcwnxnnc5n`
  (español, voz Kate; saludo + aviso de grabación, clasificación de las 5 células y
  detección de urgencia por los 4 criterios en el system prompt).
- **Número:** `+525541616006` (netelip) · `phone_number_id = phnum_2601ky90410see0axfdgrb0pbhg7`.
- **Estado:** ⏳ PENDIENTE DE VALIDACIÓN en netelip; aún no timbra. No es tema de
  código: cuando netelip valide/active el número, entra por la troncal ya configurada.

## Servidores de la integración nativa (fijos)

| Sentido | Servidor | Transporte | Cifrado | Auth |
|---------|----------|-----------|---------|------|
| **Entrante** (netelip → ElevenLabs) | `sip.rtc.elevenlabs.io` | TCP 5060 | Disabled | — |
| **Saliente** (ElevenLabs → netelip) | `elevenlabs.netelip.com` | TCP | Disabled | **digest** con la Línea SIP |

> No se usa *origination URI* manual, ni whitelist de IPs, ni configuración de
> troncal a mano: la integración nativa fija estos servidores y la autenticación
> es **digest** con las credenciales de la Línea SIP de netelip.

## Topología

```
Cliente llama → +525541616006 (netelip)
   → troncal SIP nativa → sip.rtc.elevenlabs.io (entrante)
      → Agente "Kawa" (ElevenLabs) contesta
         ├─ server tools (HTTP) → Edge Functions:
         │     sw-folio, sw-transfer-target  (+ sw-classify/sw-urgency ya en prompt)
         ├─ post-call webhook → sw-brief (folio + brief + notify + tarea G4)
         └─ transferencia → elevenlabs.netelip.com (saliente, digest) → celular G4 (PSTN)
```

- **Extensiones (softphone), opcional:** una **Línea SIP** de netelip por persona;
  el `sip_endpoint` que capturas en la UI (pestaña Extensiones) es esa dirección.
- **Transferencia al G4:** ElevenLabs cursa la saliente por `elevenlabs.netelip.com`
  (digest); el número destino lo da `sw-transfer-target` y **nunca** se expone al
  llamante.

## Registro en ElevenLabs (server tools + post-call webhook)

Base de funciones: `https://<PROJECT_REF>.supabase.co/functions/v1/<fn>`.
Todas las funciones `sw-*` van con `verify_jwt=false` y se protegen con el header
`x-switchboard-secret` = `SWITCHBOARD_WEBHOOK_SECRET` (secreto en Supabase).

### (a) Server tools (durante la llamada)

- **`sw-folio`** — `POST /functions/v1/sw-folio` `{}` → `{ "folio": "KAW-2026-0001" }`.
  Header: `x-switchboard-secret: <SWITCHBOARD_WEBHOOK_SECRET>`.
- **`sw-transfer-target`** — `POST /functions/v1/sw-transfer-target`
  `{ "celula": "LIT" }` → `{ "target_number": "+52…", "g4_id": "…" }`.
  Header: `x-switchboard-secret: …`. El `target_number` alimenta la transferencia;
  **no se dice al llamante**.
  *(Opcional)* `sw-extension-target` para transferencia directa por extensión/nombre.

### (b) Post-call webhook

- **`sw-brief`** — `POST /functions/v1/sw-brief` con la transcripción + metadata al
  terminar la llamada. Header: `x-switchboard-secret: …`.

## Variables de entorno en Supabase

- `ANTHROPIC_API_KEY` — Haiku (clasificación/urgencia) y Sonnet (brief).
- `SWITCHBOARD_WEBHOOK_SECRET` — valida los webhooks/tools del portal.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — acceso de las Edge Functions.
- `ELEVENLABS_API_KEY` — para que `sw-brief` recupere transcripción/grabación desde
  la API de ElevenLabs cuando el post-call webhook solo mande el `conversation_id`.
- `SLACK_BOT_TOKEN` — DM del brief al G4 (best-effort).

## Verificación (cuando netelip valide el número)

1. **Timbra:** llamar a `+525541616006` → contesta "Kawa" con el aviso de grabación.
2. **Tools:** durante la llamada, `sw-folio` entrega folio y `sw-transfer-target`
   resuelve el G4; confirmar en logs de Supabase.
3. **Post-call:** al colgar, `sw-brief` crea el registro → verificar en la UI
   **/conmutador → Bandeja** (folio + brief) y que llegó el aviso al G4 + la tarea.
4. **Transferencia:** llamada urgente → la saliente conecta al celular del G4 por
   `elevenlabs.netelip.com`; si no conecta en 15s, `sw-brief` levanta bandera 🔴.
5. **Aceptación (F6):** 5 células, 4 criterios de urgencia, brief <2 min, latencia
   `sw-classify` <300 ms, y que el celular del G4 nunca se oiga al llamante.

## Referencias
- ElevenLabs — SIP trunking:
  https://elevenlabs.io/docs/eleven-agents/phone-numbers/telephony/sip-trunking
- netelip — Línea SIP (configuración):
  https://www.netelip.com/centro-de-ayuda/linea-sip/configuracion-del-servicio/
- netelip — Integración con agentes de voz IA (precedente Retell AI):
  https://www.netelip.com/centro-de-ayuda/inicio-administradores/integraciones-retell-ai-con-el-servicio-de-sip-trunk-numeros-virtuales/
