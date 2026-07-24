# Conmutador — Configuración de ElevenLabs (para dejarlo conectado)

Agente: **"Kawa - Conmutador Kawiil"** · `agent_id = agent_7501ky8yndc0fe98w0hcwnxnnc5n`
Número: `+525541616006` · `phone_number_id = phnum_2601ky90410see0axfdgrb0pbhg7`

Base de las Edge Functions (proyecto Supabase `qppfampapbxdgednkofc`):

```
https://qppfampapbxdgednkofc.supabase.co/functions/v1/<funcion>
```

Autenticación de todas las `sw-*`: secreto `SWITCHBOARD_WEBHOOK_SECRET`.
- **Server tools** (durante la llamada) → header `x-switchboard-secret: <secreto>`.
- **Post-call webhook** (si el portal no admite headers) → añade `?secret=<secreto>`
  a la URL. Ambas vías son válidas.

---

## Paso 0 — Supabase (prerequisito)

1. **Secrets** (Supabase → Project Settings → Edge Functions → Secrets):
   - `SWITCHBOARD_WEBHOOK_SECRET` = (genera una cadena larga aleatoria)
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `SLACK_BOT_TOKEN` (para el DM del brief al G4)
2. **Deploy** de migraciones y funciones:
   ```bash
   supabase db push
   supabase functions deploy sw-classify sw-urgency sw-transfer-target \
     sw-extension-target sw-folio sw-brief
   ```
   (o dejar que el pipeline lo despliegue al mergear el PR #187).
3. **Datos** para que las transferencias tengan destino:
   - Cada célula debe tener G4 con **celular en formato E.164** (`+52…`) en RH /
     `profiles.phone` (o un override en `switchboard_config`).
   - (Opcional) Extensiones cargadas en la UI → pestaña Extensiones.

---

## Paso 1 — Server tools (durante la llamada)

En el agente → **Tools** → añade cada una como *Server Tool* (Webhook), método
**POST**, con el header `x-switchboard-secret`.

> El agente ya clasifica célula y urgencia en el system prompt; las tools que
> necesita en vivo son **sw-transfer-target** y **sw-folio** (y opcionalmente
> **sw-extension-target**).

### `sw_transfer_target`  (obligatoria)
- URL: `…/functions/v1/sw-transfer-target`
- Body (parámetros que llena el agente):
  ```json
  { "celula": "LIT | CORP | COMP | CONT | PROC" }
  ```
- Respuesta: `{ "target_number": "+52…", "g4_id": "…", "g4_nombre": "…" }`
- Uso: el `target_number` es el destino de la transferencia. **Nunca leerlo al
  llamante.**

### `sw_folio`  (obligatoria)
- URL: `…/functions/v1/sw-folio`
- Body: `{}`
- Respuesta: `{ "folio": "KAW-2026-0001" }`

### `sw_extension_target`  (opcional — transferencia directa por persona)
- URL: `…/functions/v1/sw-extension-target`
- Body: `{ "extension": "101" }`  o  `{ "nombre": "Ana López" }`
- Respuesta: `{ "sip_endpoint": "sip:…" }` o `{ "needs_disambiguation": true, "opciones": [...] }`

---

## Paso 2 — Instrucciones de tools en el system prompt

Añade al prompt del agente (además de lo que ya tiene):

```
Herramientas:
- Cuando tengas clara la célula y vayas a canalizar, llama a sw_transfer_target con
  esa célula. Usa el "target_number" que devuelve SOLO para transferir; NUNCA lo
  menciones ni lo leas al llamante.
- Antes de cerrar, llama a sw_folio y comparte el "folio" con el llamante como
  referencia de su seguimiento.
- Si el llamante pide a una persona por nombre o da una extensión, llama a
  sw_extension_target; si responde needs_disambiguation, pregunta cuál de las
  opciones y reintenta. Nunca leas el "sip_endpoint".
- Ruta urgente: si detectas urgencia (audiencia <48h, persona detenida,
  requerimiento de autoridad, o lenguaje de urgencia), transfiere de inmediato tras
  tomar los datos mínimos.
```

---

## Paso 3 — Transferencia (SIP REFER)

En el agente → acción de **Transfer to number** (o transfer SIP):
- Número destino = **dinámico**, tomado de `sw_transfer_target.target_number` (o de
  `sw_extension_target.sip_endpoint` para extensión).
- La saliente se cursa por `elevenlabs.netelip.com` (digest con la Línea SIP).
- Si no conecta en 15s, el agente toma los datos y cuelga; `sw-brief` marcará 🔴.

---

## Paso 4 — Post-call webhook → `sw-brief`

En **Settings → Webhooks** (o en el agente, sección post-call):
- URL: `…/functions/v1/sw-brief?secret=<SWITCHBOARD_WEBHOOK_SECRET>`
  (o sin `?secret=` si configuras el header `x-switchboard-secret`).
- Evento: fin de llamada (post-call), con transcripción + metadata.
- Payload esperado por `sw-brief` (mapear los campos del agente): `celula`,
  `urgente`, `llamante`, `empresa`, `es_cliente`, `telefono`, `correo`, `motivo`,
  `folio`, `conversation_id`, `transcript`, `transcript_url`, `recording_url`,
  `transfer.connected`. Si solo llega `conversation_id`, `sw-brief` puede recuperar
  la transcripción/grabación con `ELEVENLABS_API_KEY` (ver opción A del backlog).

---

## Paso 5 — Verificación end-to-end (cuando netelip valide el número)

1. Llamar a `+525541616006` → contesta "Kawa" con aviso de grabación.
2. Dar un motivo por célula → el agente clasifica y, al canalizar, `sw_transfer_target`
   devuelve el G4; `sw_folio` entrega folio.
3. Colgar → `sw-brief` crea el registro; revisar en **/conmutador → Bandeja**
   (folio + brief) y que llegó el aviso + tarea al G4.
4. Llamada urgente → la transferencia conecta al G4; si no en 15s, brief con 🔴.
