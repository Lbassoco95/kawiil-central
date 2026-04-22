export type SlackQuickReplyOpenInput = {
  entity_ref?: string | null;
  entity_id?: string | null;
  entity_type?: string | null;
  notificationTitle?: string | null;
};

/**
 * Abre el panel de respuesta rápida a Slack desde código que no tiene acceso a React Context
 * (p. ej. toasts de Sonner, que se portalean fuera del árbol del layout).
 */
export const OPEN_SLACK_QUICK_REPLY_EVENT = "kawiil:open-slack-quick-reply";

export function openSlackQuickReplyDispatch(input: SlackQuickReplyOpenInput): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SLACK_QUICK_REPLY_EVENT, { detail: input }));
}
