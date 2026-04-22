import type { ReactNode } from "react";

/**
 * Patrón compartido para @menciones en textos de comentarios (tareas, proyecto, pasos, etc.).
 * Debe alinearse con la detección en MentionTextarea (grupo sin @ en el regex de extracción).
 */
const MENTION_DISPLAY_SOURCE =
  "(@[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\\w][a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\\w\\s]*[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\\w])";

function mentionSplitRegex(): RegExp {
  return new RegExp(MENTION_DISPLAY_SOURCE, "g");
}

/**
 * Resalta cada @mención con el estilo de mención (sin exigir que exista en el directorio).
 */
export function renderTextWithMentionHighlights(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];
  const parts = text.split(mentionSplitRegex());
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span key={`${keyPrefix}-m-${i}`} className="text-primary font-bold">
          {part}
        </span>
      );
    }
    return <span key={`${keyPrefix}-t-${i}`}>{part}</span>;
  });
}
