/** Límites para no disparar tokens en ai-chat. */
const MAX_PER_MESSAGE = 3500;
const MAX_TOTAL = 14000;

function stripHtmlForContext(html: string): string {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function messageTimestamp(m: Record<string, unknown>): string {
  return String(m.receivedDateTime || m.sentDateTime || m.createdDateTime || "");
}

function mergeThreadMessages(
  detail: Record<string, unknown> | null | undefined,
  threadEmails: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const m of threadEmails) {
    const id = m?.id;
    if (typeof id === "string" && id) byId.set(id, m);
  }
  if (detail && typeof detail.id === "string" && detail.id) {
    byId.set(detail.id, detail as Record<string, unknown>);
  }
  return Array.from(byId.values());
}

/**
 * Texto plano del hilo para el asistente IA: orden cronológico, tope por mensaje y global.
 * Marca el mensaje al que se responde (`replyToMessageId`).
 */
export function buildThreadContextForAi(
  emailDetail: Record<string, unknown> | null | undefined,
  threadEmails: Record<string, unknown>[],
  replyToMessageId: string | null | undefined,
): string {
  if (!replyToMessageId) return "";

  const merged = mergeThreadMessages(emailDetail, threadEmails || []);
  const sorted = [...merged].sort((a, b) => {
    const ta = Date.parse(messageTimestamp(a)) || 0;
    const tb = Date.parse(messageTimestamp(b)) || 0;
    return ta - tb;
  });

  const blocks: string[] = [];
  let total = 0;

  for (const m of sorted) {
    const id = typeof m.id === "string" ? m.id : "";
    const from =
      (m.from as { emailAddress?: { name?: string; address?: string } } | undefined)?.emailAddress?.name ||
      (m.from as { emailAddress?: { name?: string; address?: string } } | undefined)?.emailAddress?.address ||
      "Desconocido";
    const subject = typeof m.subject === "string" ? m.subject : "";
    const bodyRaw =
      (m.body as { content?: string } | undefined)?.content != null
        ? String((m.body as { content?: string }).content)
        : typeof m.bodyPreview === "string"
          ? m.bodyPreview
          : "";
    let plain = stripHtmlForContext(bodyRaw);
    let truncated = false;
    if (plain.length > MAX_PER_MESSAGE) {
      plain = plain.slice(0, MAX_PER_MESSAGE);
      truncated = true;
    }

    const isReplyTarget = id === replyToMessageId;
    const header = isReplyTarget
      ? `--- Mensaje (RESPONDER A ESTE) | ${messageTimestamp(m)} | De: ${from}${subject ? ` | Asunto: ${subject}` : ""} ---`
      : `--- Mensaje | ${messageTimestamp(m)} | De: ${from}${subject ? ` | Asunto: ${subject}` : ""} ---`;

    const piece = `${header}\n${plain}${truncated ? "\n[… mensaje truncado]" : ""}\n`;
    if (total + piece.length > MAX_TOTAL) {
      blocks.push("[… hilo truncado por límite total de contexto]\n");
      break;
    }
    blocks.push(piece);
    total += piece.length;
  }

  if (blocks.length === 0) return "";

  return `Conversación (orden cronológico, del más antiguo al más reciente):\n\n${blocks.join("\n")}`;
}
