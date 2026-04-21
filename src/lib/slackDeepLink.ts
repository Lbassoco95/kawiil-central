/**
 * Helpers para convertir la referencia de una notificación de Slack
 * (`entity_ref`: `canal|ts` o `canal|thread_ts|reply_ts` desde `slack-events`)
 * en una URL a `/comunicacion` con scroll + highlight; en hilos se añade `reply`.
 */

export type SlackDeepLinkParts = {
  channel: string;
  /** Ancla en la lista principal (mensaje raíz o padre del hilo). */
  mainTs: string;
  /** Ts del mensaje dentro del hilo (respuesta); ausente en refs de 2 segmentos. */
  replyTs?: string;
};

/**
 * Partes normalizadas; mantiene `ts` como alias de `mainTs` para compatibilidad.
 */
export type SlackDeepLinkPartsCompat = SlackDeepLinkParts & { ts: string };

function segmentsFromRef(ref: string): string[] {
  return ref
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseSlackEntityRef(ref?: string | null): SlackDeepLinkPartsCompat | null {
  if (!ref) return null;
  const segs = segmentsFromRef(ref);
  if (segs.length < 2) return null;
  const channel = segs[0];
  if (segs.length === 2) {
    const mainTs = segs[1];
    if (!channel || !mainTs) return null;
    return { channel, mainTs, ts: mainTs };
  }
  const mainTs = segs[1];
  const replyTs = segs[2];
  if (!channel || !mainTs || !replyTs) return null;
  return { channel, mainTs, replyTs, ts: mainTs };
}

/** Ts del mensaje concreto (respuesta o único) para feed / contadores por mensaje. */
export function slackEntityLeafMessageTs(ref?: string | null): string | null {
  const p = parseSlackEntityRef(ref);
  if (!p) return null;
  return p.replyTs ?? p.mainTs;
}

export function slackDeepLinkPath(ref?: string | null): string | null {
  const parts = parseSlackEntityRef(ref);
  if (!parts) return null;
  const q = new URLSearchParams();
  q.set("channel", parts.channel);
  q.set("ts", parts.mainTs);
  if (parts.replyTs) q.set("reply", parts.replyTs);
  return `/comunicacion?${q.toString()}`;
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
