# Conmutador — Checklists de portal, pruebas y go-live

Los pasos de telefonía (F1) y buena parte de la configuración del agente (F2) son
**configuración en portales** (Telnyx / ElevenLabs), no código. Aquí quedan como
checklist accionable.

## F1 — Telefonía (Telnyx)

- [ ] Crear cuenta Telnyx.
- [ ] Adquirir DID local (confirmar lada: 55 CDMX / 33 GDL / 81 MTY).
- [ ] Verificación con domicilio fiscal MX (Constancia de Situación Fiscal del SAT).
- [ ] Configurar SIP Trunk Telnyx → ElevenLabs.
- [ ] Definir aviso de grabación (LFPDPPP): "Esta llamada puede ser grabada para
      mejorar la atención." (ya incluido en el prompt base).

## F2 — Agente base (ElevenLabs)

- [ ] Cargar el prompt base (`prompts/00-agente-base.md`) como system prompt.
- [ ] Elegir nombre y voz (Voice Library) y registrar el `voice_id` en
      `switchboard_config.voz`.
- [ ] Registrar las tools/webhooks (`prompts/tools-webhooks.md`): sw-classify,
      sw-urgency, sw-transfer-target, sw-folio y el webhook post-llamada sw-brief.
- [ ] Configurar el manejo de transferencia SIP (`prompts/transferencia-sip.md`).
- [ ] Configurar el secreto `SWITCHBOARD_WEBHOOK_SECRET` en Supabase y en el header
      de las tools del portal.

## F6 — Pruebas

- [ ] Llamada de prueba por cada una de las 5 células (ruta estándar).
- [ ] Llamada urgente por cada criterio (audiencia<48h, detención, requerimiento,
      urgencia declarada) → validar el SIP REFER.
- [ ] Validar formato del brief y entrega <2 min por el canal elegido.
- [ ] Medir latencia de `sw-classify` (<300 ms) y ajustar el prompt si hace falta.
- [ ] Configurar mensaje de respaldo (SMS/WhatsApp con contacto directo) si el
      agente cae.
- [ ] Verificar que el celular del G4 nunca aparece al llamante.

> La lógica pura (4 criterios de urgencia, folio, clasificación, brief) tiene
> pruebas automatizadas en `src/lib/conmutador.test.ts` (vitest). El folio
> consecutivo es atómico a nivel Postgres (`next_switchboard_folio`), lo que
> garantiza 0 duplicados aun con llamadas concurrentes.

## F7 — Go-live + UI

- [ ] Sección React "Conmutador" (`/conmutador`) — hecha: bandeja con filtros por
      célula/urgencia, enlaces a transcripción/grabación y edición de
      `switchboard_config`.
- [ ] Activar el número en producción.
- [ ] Comunicar al equipo y monitorear las primeras semanas.
- [ ] Criterio de éxito del piloto: 0 llamadas perdidas, 100% de briefs entregados
      en <2 min.
