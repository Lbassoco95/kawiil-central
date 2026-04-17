

## Diagnóstico final (ya con datos)

1. `notifications.entity_id` es **uuid** (confirmado por tu query #1).
2. La edge `slack-events` (línea 607) intenta insertar `entity_id = "C094986CE1K|1750..."` (text). Postgres rechaza: 0 filas Slack en BD (confirmado por queries #2/#3 que corrí: solo hay `expense`, `mention`, `task_assigned`).
3. El cliente (`useSlackChannelNotificationBadges.ts` línea 55) consulta `.like("entity_id", "<channel>|%")` sobre uuid → 404 `42883: operator does not exist: uuid ~~ unknown`.
4. Ese 404 dispara fallos en cascada en `useSlackUnreadSync.ts` que invalidan `slack-history` y producen el spinner perpetuo en ciertos canales.
5. **Conclusión**: nunca han funcionado las notifs Slack en BD (siempre fallaron al insertar). El badge nunca tuvo de dónde leer. Hoy lo que rompe la UI es el LIKE sobre uuid.

## Plan (tu Supabase real `qppfampapbxdgednkofc`, sin tocar Lovable Cloud, sin migrar datos)

### Paso 1 — Migración de schema (BD)
Añadir columna `entity_ref text` para identificadores no-uuid (Slack `channel|ts`, futuros casos):
```sql
ALTER TABLE public.notifications ADD COLUMN entity_ref text;
CREATE INDEX notifications_entity_ref_slack_idx
  ON public.notifications (user_id, entity_ref)
  WHERE entity_type = 'slack' AND is_read = false;
```
`entity_id` queda `null` para Slack. No se migran datos (no hay).

### Paso 2 — Edge function `slack-events`
Cambiar línea 607 y línea 617 para usar `entity_ref` en lugar de `entity_id`:
- `entity_id: null, entity_ref: \`${channel}|${ts}\``
- Dedup: `.eq("entity_ref", entityRef)` en lugar de `.eq("entity_id", entityId)`.
- Redeploy de `slack-events` (sin `--no-verify-jwt` extra; ya está configurado).

### Paso 3 — Cliente
- `useSlackChannelNotificationBadges.ts`:
  - SELECT: `.select("entity_ref").not("entity_ref","is",null)`.
  - `markSlackChannelNotificationsRead`: `.like("entity_ref", "<channel>|%")` (text, sí soporta LIKE).
- `useSlackUnreadSync.ts`: envolver `markSlackChannelNotificationsRead` en try/catch que **no** invalide queries si falla → corta el bucle del spinner aunque algo vuelva a romperse en el futuro.

### Paso 4 — Errores TS sueltos (no relacionados a Slack pero rompen el build)
Arreglos puntuales:
- `ProjectSidebar.tsx:99` — quitar prop `title` del icono Lucide (envolver en `<span title>`).
- `PersonalProjectsProgress.tsx:37` — convertir number a `\`${n}ms\`` para `animationDelay`.
- `EmailView.tsx:479,541,709,719` — tipar `attachments` (hoy `unknown`).
- `RichTextEditor.tsx:113` — quitar segundo argumento `false` de `setContent`.
- `LeadActivityPanel.tsx:61` — el dialog hijo no acepta `onOpenChange`; revisar prop correcto.
- `StepFileManager.tsx`, `useClients.ts` — completar args 4-5 que faltan en helper.
- `useChat.ts:716-717` — quitar `.detail` (no existe en el tipo de error).
- `useClientGroups.ts`, `useFinanceAccess.ts`, `useKnowledge.ts`, `useModulePermissions.ts` — los errores `Type instantiation excessively deep` y `'never'` salen porque `src/integrations/supabase/types.ts` está desactualizado/recortado. Hay que **regenerar `types.ts`** contra el proyecto real `qppfampapbxdgednkofc`. Una vez regenerado, esos errores desaparecen solos.

### Paso 5 — Verificación
- Recargar Comunicación, abrir cumplimiento-sylon / vizum / mpim ruidoso.
- Network: ya no debe aparecer `42883`.
- Composer aparece, historial carga, badges bajan al abrir canal.
- Mandar mensaje de prueba en Slack y confirmar que aparece notif en Kawiil (badges suben, push llega).

## Lo que NO toco
- `.env`, `client.ts`, `supabase/config.toml` — siguen apuntando a tu Supabase real.
- Lovable Cloud — nada se mueve ahí.
- Datos existentes — no hay nada que migrar (cero filas Slack).

