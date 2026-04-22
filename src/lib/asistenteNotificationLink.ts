/**
 * Deep link desde `notifications` (entity_type = asistente, entity_id = chat_conversations.id).
 */
export function asistenteChatDeepLinkFromNotification(row: {
  entity_type?: string | null;
  entity_id?: string | null;
}): string | null {
  if (row.entity_type !== "asistente" || !row.entity_id?.trim()) return null;
  const id = row.entity_id.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return `/asistente?conversation=${encodeURIComponent(id)}`;
}
