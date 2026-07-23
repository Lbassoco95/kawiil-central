# Conmutador — Configuración de "tools" (webhooks) en ElevenLabs

El agente base invoca nuestras Edge Functions de Supabase como *tools* (server
webhooks). Todas cuelgan de la base de funciones del proyecto:

```
https://<PROJECT_REF>.supabase.co/functions/v1/<nombre-funcion>
```

Autenticación: header `Authorization: Bearer <SUPABASE_ANON_KEY>` (o un secreto
dedicado `SWITCHBOARD_WEBHOOK_SECRET` validado por la función). Nunca expongas la
`service_role` key en el portal.

> Los `voice_id`, claves de Anthropic/ElevenLabs/Telnyx viven en variables de
> entorno de Supabase, **nunca** en el repo ni en el portal como texto plano.

## Tools durante la llamada

### 1. `sw-classify`

- **Cuándo:** apenas el llamante describe su motivo.
- **Request** `POST /functions/v1/sw-classify`
  ```json
  { "motivo": "texto corto del llamante" }
  ```
- **Response**
  ```json
  {
    "celula": "LIT|CORP|COMP|CONT|PROC",
    "confidence": 0.0,
    "needs_disambiguation": false,
    "pregunta_sugerida": null
  }
  ```
- **Uso:** si `needs_disambiguation`, el agente hace `pregunta_sugerida` y vuelve
  a clasificar. Objetivo de latencia < 300 ms.

### 2. `sw-urgency`

- **Cuándo:** conforme avanza la transcripción parcial.
- **Request** `POST /functions/v1/sw-urgency`
  ```json
  { "transcript": "transcripción parcial acumulada" }
  ```
- **Response**
  ```json
  { "urgente": true, "criterios": ["audiencia_48h"], "detalle": "…" }
  ```
- **Uso:** si `urgente = true`, el agente pasa a la ruta urgente.

### 3. `sw-transfer-target`

- **Cuándo:** justo antes de ejecutar el SIP REFER (ruta urgente).
- **Request** `POST /functions/v1/sw-transfer-target`
  ```json
  { "celula": "LIT" }
  ```
- **Response**
  ```json
  { "target_number": "+52…", "g4_id": "uuid", "g4_nombre": "…", "source": "rh|override" }
  ```
- **Uso:** el `target_number` alimenta el SIP REFER. **NUNCA** se dice al llamante.

### 4. `sw-folio`

- **Cuándo:** al confirmar que se atenderá el caso (antes del cierre).
- **Request** `POST /functions/v1/sw-folio` `{}`
- **Response** `{ "folio": "KAW-2026-0001" }`
- **Uso:** se comparte el folio con el llamante como referencia de seguimiento.

## Webhook post-llamada

### `sw-brief`

- **Cuándo:** al terminar la llamada, ElevenLabs envía la transcripción completa y
  el enlace a la grabación al webhook post-llamada.
- **Request** `POST /functions/v1/sw-brief`
  ```json
  {
    "conversation_id": "…",
    "folio": "KAW-2026-0001",
    "celula": "CONT",
    "urgente": false,
    "llamante": "…",
    "empresa": "…",
    "es_cliente": true,
    "telefono": "+52…",
    "correo": "…",
    "motivo": "…",
    "transcript": "…",
    "transcript_url": "https://…",
    "recording_url": "https://…",
    "transfer": { "connected": true }
  }
  ```
- **Efecto:** persiste en `switchboard_call`, genera el brief con Claude Sonnet,
  notifica al G4 vía `notify` y crea una tarea en `agent_tasks`.

## Checklist de configuración en el portal

- [ ] Registrar las 4 tools de llamada con sus URLs y el header de auth.
- [ ] Registrar el webhook post-llamada apuntando a `sw-brief`.
- [ ] Guardar los `voice_id` en `switchboard_config.voz`.
- [ ] Verificar que ninguna respuesta expone `target_number`/`g4_id` al llamante.
