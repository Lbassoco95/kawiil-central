# Aviso de privacidad — Reclutamiento (LFPDPPP)

- **Aviso integral público:** `/aviso-privacidad` (`src/pages/AvisoPrivacidad.tsx`, sin sesión). Versión y fecha en `src/lib/privacyNotice.ts` (`PRIVACY_NOTICE_VERSION`, hoy `2026-10-31`).
- **Formulario** `/postular/:token`: aviso simplificado + 2 checkboxes. El envío se deshabilita sin el checkbox 1; la edge function `recruit-apply` además rechaza (400) si `privacy_accepted !== true`.
- **Registro inmutable:** tabla `rh_candidate_consents` (migración `20261031120000`). Guarda estado de ambos checkboxes, versión del aviso y `consented_at` (UTC, lo asigna la BD). Solo service role inserta; reclutadores solo leen; trigger bloquea UPDATE/DELETE. `candidate_id` sin FK para conservar la evidencia si el expediente se cancela por ARCO.
- **RH:** `TalentPoolBadge` en la tarjeta y en el perfil del candidato: Base de talentos / Solo este proceso / Sin registro.
- **Al cambiar el aviso:** actualizar `PRIVACY_NOTICE_VERSION` en `src/lib/privacyNotice.ts` **y** la constante homónima en `supabase/functions/recruit-apply/index.ts`, más la fecha mostrada.
