import { AiFeedback } from "@/components/ai/AiFeedback";

/**
 * Calificación 👍 / 👎 para un mensaje del asistente (chat).
 * Envoltura delgada sobre <AiFeedback> con el estilo del hilo de chat.
 */
export function AiMessageFeedback({ messageId }: { messageId: string }) {
  return (
    <AiFeedback surface="chat" chatMessageId={messageId} className="mt-1.5 ml-10" />
  );
}
