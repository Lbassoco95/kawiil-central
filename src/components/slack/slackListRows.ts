import type { SlackMessage } from "@/lib/slackApi";
import {
  isSlackSystemSubtype,
  sameSlackDay,
  slackTsToMs,
} from "@/lib/slackFormatting";

export type SlackListRow =
  | { type: "day"; key: string; ts: string }
  | { type: "newDivider"; key: string }
  | { type: "system"; key: string; message: SlackMessage }
  | {
      type: "message";
      key: string;
      message: SlackMessage;
      group: boolean;
      showHeader: boolean;
    };

/** Aplana el historial a filas virtualizables (día, «Nuevos», sistema, mensaje). */
export function buildSlackListRows(
  messages: SlackMessage[],
  lastReadTs: string | null,
): SlackListRow[] {
  let prevTs: string | undefined;
  let newDividerRendered = false;
  const lastReadMs = lastReadTs ? slackTsToMs(lastReadTs) : null;
  const rows: SlackListRow[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (prevTs && !sameSlackDay(prevTs, m.ts)) {
      rows.push({ type: "day", key: `day-${m.ts}`, ts: m.ts });
    }

    if (lastReadMs != null && !newDividerRendered && slackTsToMs(m.ts) > lastReadMs) {
      rows.push({ type: "newDivider", key: `new-divider-${m.ts}` });
      newDividerRendered = true;
    }

    if (isSlackSystemSubtype(m.subtype)) {
      rows.push({ type: "system", key: m.ts, message: m });
      prevTs = m.ts;
      continue;
    }

    const prevMsg = i > 0 ? messages[i - 1] : undefined;
    const uid = m.user;
    const group = !!(
      prevMsg &&
      !isSlackSystemSubtype(prevMsg.subtype) &&
      !isSlackSystemSubtype(m.subtype) &&
      prevMsg.user === uid &&
      uid &&
      slackTsToMs(m.ts) - slackTsToMs(prevMsg.ts) < 5 * 60 * 1000
    );
    const showHeader = !group;

    rows.push({
      type: "message",
      key: m.ts,
      message: m,
      group,
      showHeader,
    });
    prevTs = m.ts;
  }

  return rows;
}

export function estimateSlackRowHeight(row: SlackListRow): number {
  switch (row.type) {
    case "day":
      return 52;
    case "newDivider":
      return 40;
    case "system":
      return 44;
    default:
      return row.showHeader ? 132 : 88;
  }
}

/** Timestamp raíz del hilo para API y UI (mensaje padre o broadcast en canal). */
export function slackThreadRootTs(m: SlackMessage): string {
  return m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : m.thread_ts || m.ts;
}
