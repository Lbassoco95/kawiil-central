/**
 * Helpers para convertir la referencia canónica de una notificación de Slack
 * (`entity_ref = "<canal>|<ts>"` que graba `supabase/functions/slack-events`)
 * en una URL/deep link al mensaje dentro de `/comunicacion`, donde
 * `SlackMessageList` ya soporta `?channel=…&ts=…` con scroll + highlight.
 */

export type SlackDeepLinkParts = {
  channel: string;
  ts: string;
};

export function parseSlackEntityRef(ref?: string | null): SlackDeepLinkParts | null {
  if (!ref) return null;
  const pipe = ref.indexOf("|");
  if (pipe <= 0) return null;
  const channel = ref.slice(0, pipe).trim();
  const ts = ref.slice(pipe + 1).trim();
  if (!channel || !ts) return null;
  return { channel, ts };
}

export function slackDeepLinkPath(ref?: string | null): string | null {
  const parts = parseSlackEntityRef(ref);
  if (!parts) return null;
  return `/comunicacion?channel=${encodeURIComponent(parts.channel)}&ts=${encodeURIComponent(parts.ts)}`;
}

type SlackDeepLinkInput = {
  entity_type?: string | null;
  entity_ref?: string | null;
  entity_id?: string | null;
  type?: string | null;
};

/**
 * Prioriza `entity_ref` (fuente canónica) y cae a `entity_id` solo como compatibilidad
 * con notificaciones antiguas que guardaban el deep link ahí.
 */
export function slackDeepLinkFromNotification(row: SlackDeepLinkInput): string | null {
  const direct = slackDeepLinkPath(row.entity_ref);
  if (direct) return direct;
  if (row.entity_type === "slack") {
    const legacy = slackDeepLinkPath(row.entity_id);
    if (legacy) return legacy;
  }
  return null;
}
