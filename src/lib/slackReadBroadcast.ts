import { supabase } from "@/integrations/supabase/client";
import { saveSlackReadCursor } from "@/lib/slackReadCursor";

/**
 * Identificador estable por dispositivo/pestaña. Lo usamos para que un broadcast emitido por
 * esta misma pestaña no la haga reaccionar (evita bucles e invalidaciones redundantes).
 *
 * - Persistente por pestaña vía `sessionStorage` (sobrevive recargas, no se comparte entre tabs).
 * - Si no hay `sessionStorage` (SSR/sandbox), generamos uno volátil.
 */
const DEVICE_ID_STORAGE_KEY = "kawiil-slack-read-broadcast-device-id";

let cachedDeviceId: string | null = null;

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSlackReadBroadcastDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      const stored = window.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (stored) {
        cachedDeviceId = stored;
        return stored;
      }
      const fresh = generateId();
      window.sessionStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
      cachedDeviceId = fresh;
      return fresh;
    } catch {
      /* sessionStorage bloqueado: usar volátil */
    }
  }
  cachedDeviceId = generateId();
  return cachedDeviceId;
}

export type SlackReadBroadcastPayload = {
  channelId: string;
  /** `last_read_ts` de Slack (string con `.` por la API). Opcional si solo marcamos badges Kawiil. */
  lastReadTs?: string;
  /** ID del dispositivo emisor (para que no reaccione a su propio broadcast). */
  source: string;
  /** Marca temporal ISO; útil para descartar mensajes muy viejos. */
  at: string;
};

export const SLACK_READ_BROADCAST_EVENT = "slack-read";

function topicForUser(userId: string): string {
  /**
   * Slack broadcast por usuario. Se usa el patrón `user:{id}:slack-read` para mantener un único
   * canal por usuario con todos sus dispositivos. Realtime de Supabase lo enruta automáticamente.
   */
  return `slack-read:${userId}`;
}

const activeBroadcastChannelByUser = new Map<string, ReturnType<typeof supabase.channel>>();

/**
 * Devuelve un canal Realtime para el usuario actual; lo crea y suscribe si no existía.
 * Idempotente: invocaciones repetidas para el mismo `userId` reusan el canal.
 */
export function ensureSlackReadBroadcastChannel(userId: string) {
  const existing = activeBroadcastChannelByUser.get(userId);
  if (existing) return existing;
  const channel = supabase.channel(topicForUser(userId), {
    config: {
      broadcast: { self: false, ack: false },
    },
  });
  channel.subscribe();
  activeBroadcastChannelByUser.set(userId, channel);
  return channel;
}

export function teardownSlackReadBroadcastChannel(userId: string): void {
  const ch = activeBroadcastChannelByUser.get(userId);
  if (!ch) return;
  try {
    void supabase.removeChannel(ch);
  } catch {
    /* noop */
  }
  activeBroadcastChannelByUser.delete(userId);
}

/**
 * Emite un broadcast informando que se acaba de leer un canal Slack en este dispositivo.
 * Otros dispositivos del mismo usuario lo reciben y limpian sus badges/snapshot inmediatamente,
 * sin esperar el próximo ciclo de polling (~30 s).
 */
export async function broadcastSlackChannelRead(
  userId: string,
  channelId: string,
  lastReadTs: string | undefined,
): Promise<void> {
  if (!userId || !channelId) return;
  const channel = ensureSlackReadBroadcastChannel(userId);
  const payload: SlackReadBroadcastPayload = {
    channelId,
    lastReadTs,
    source: getSlackReadBroadcastDeviceId(),
    at: new Date().toISOString(),
  };
  try {
    await channel.send({
      type: "broadcast",
      event: SLACK_READ_BROADCAST_EVENT,
      payload,
    });
  } catch (err) {
    console.warn("[slack-read-broadcast] send falló", {
      userId,
      channelId,
      lastReadTs,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Aplica un broadcast remoto a este dispositivo: persiste cursor local para evitar que
 * el snapshot vuelva a contar mensajes ya leídos. No invalida queries — eso es
 * responsabilidad del caller (`useNotificationDelivery`) para mantener el módulo libre de React.
 */
export function applyRemoteSlackReadBroadcast(
  userId: string,
  payload: SlackReadBroadcastPayload,
): void {
  if (!userId || !payload?.channelId) return;
  if (payload.lastReadTs && payload.lastReadTs.trim()) {
    saveSlackReadCursor(userId, payload.channelId, payload.lastReadTs.trim());
  }
}
