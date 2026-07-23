# Conmutador Kawiil — Telefonía + secretario IA

Secretario/a virtual que atiende el número principal de Kawiil, entiende el motivo
de cada llamada, la **clasifica por célula**, detecta **urgencia**, transfiere en
vivo al **G4 vigente** cuando corresponde y entrega un **brief** con folio a quien
toca — todo sin exponer datos internos al llamante.

## Arquitectura

```
Llamante ──▶ Telnyx (DID + SIP Trunk) ──▶ ElevenLabs (agente de voz "Kawa")
                                             │  tools (webhooks) durante la llamada
                                             ├─▶ sw-classify        (Claude Haiku)
                                             ├─▶ sw-urgency         (reglas + Haiku)
                                             ├─▶ sw-transfer-target (G4 desde RH)
                                             └─▶ sw-folio           (folio atómico)
                                             │
                                             └─ webhook post-llamada
                                                └─▶ sw-brief (Claude Sonnet)
                                                      ├─ switchboard_call (persistencia)
                                                      ├─ notify → G4 (Slack/WhatsApp/correo)
                                                      └─ agent_tasks (tarea de seguimiento)
```

## Piezas en el repo

| Pieza | Ubicación |
|-------|-----------|
| Prompt base + tools + SIP | `docs/conmutador/prompts/` |
| Preguntas por célula | `docs/conmutador/prompts/celula-*.md` |
| Migración (tablas + vista + RLS) | `supabase/migrations/20260723120000_switchboard_module.sql` |
| Edge Functions | `supabase/functions/sw-*` |
| UI React | `src/pages/Conmutador*` / `src/components/conmutador/` |

## Células y mapeo al catálogo de RH

El Conmutador usa 5 códigos. **No se duplica** el catálogo de células/G4 de RH:
la vista `v_g4_por_celula` lee el G4 vigente desde `public.celulas`
(`responsible_user_id`) + `public.profiles` (nombre/teléfono), enlazando por
`switchboard_config.celula_slug`. El mapeo por defecto (editable en la UI):

| Código | Ámbito | `celula_slug` (RH) |
|--------|--------|--------------------|
| LIT | litigio, audiencias, amparos, detenciones | `juicios` |
| CORP | sociedades, contratos, fusiones | `legal` |
| COMP | PLD-FT, KYC, regulación, auditorías | `pld_ft` |
| CONT | SAT, IMSS, declaraciones, facturas, nómina | `contabilidad` |
| PROC | procesos internos | `softlanding` *(placeholder ajustable)* |

Cada célula admite un **override** de G4 (`switchboard_config.g4_override_user_id`)
sin tocar el catálogo de RH.

## Variables de entorno (Supabase → nunca en el repo)

- `ANTHROPIC_API_KEY` — Claude Haiku (clasificación/urgencia) y Sonnet (brief).
- `ELEVENLABS_API_KEY`, `TELNYX_API_KEY` — telefonía/voz.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — acceso de las Edge Functions.
- `SWITCHBOARD_WEBHOOK_SECRET` *(opcional)* — valida los webhooks del portal.

## Privacidad y cumplimiento

- Aviso de grabación (LFPDPPP) al inicio de cada llamada.
- El celular del G4 (`target_number`) es interno: nunca se pronuncia ni se muestra
  al llamante ni en la UI de la bandeja.
