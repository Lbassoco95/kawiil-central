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

export type RenderMentionHighlightsOptions = {
  /** Por defecto `text-primary font-bold`. Útil en burbujas oscuras (p. ej. usuario en chat). */
  mentionClassName?: string;
};

const DEFAULT_MENTION_CLASS = "text-primary font-bold";

/**
 * Resalta cada @mención con el estilo de mención (sin exigir que exista en el directorio).
 */
export function renderTextWithMentionHighlights(
  text: string,
  keyPrefix: string,
  options?: RenderMentionHighlightsOptions,
): ReactNode[] {
  if (!text) return [];
  const mentionClassName = options?.mentionClassName ?? DEFAULT_MENTION_CLASS;
  const parts = text.split(mentionSplitRegex());
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span key={`${keyPrefix}-m-${i}`} className={mentionClassName}>
          {part}
        </span>
      );
    }
    return <span key={`${keyPrefix}-t-${i}`}>{part}</span>;
  });
}
