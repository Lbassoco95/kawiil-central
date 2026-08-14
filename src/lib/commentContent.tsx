import DOMPurify from "dompurify";
import type { ReactNode } from "react";
import { renderTextWithMentionHighlights } from "./renderMentionHighlights";

/**
 * Utilidades para el contenido de comentarios de tarea.
 *
 * Un comentario puede ser:
 *  - Texto plano heredado (con @menciones detectadas por nombre).
 *  - HTML enriquecido (negritas, listas, enlaces y @menciones como <span> con data-id).
 *
 * En ambos casos, los adjuntos se guardan como líneas `📎 [nombre](url)` al final
 * del contenido y se separan del cuerpo para mostrarse como tarjetas.
 */

export type CommentAttachmentRef = { name: string; url: string };

const ATTACHMENT_RE_SOURCE = "📎\\s*\\[([^\\]]+)\\]\\(([^)]+)\\)";

/** Separa el cuerpo del comentario de sus adjuntos `📎 [nombre](url)`. */
export function parseComment(content: string): {
  body: string;
  attachments: CommentAttachmentRef[];
} {
  const attachments: CommentAttachmentRef[] = [];
  const rx = new RegExp(ATTACHMENT_RE_SOURCE, "g");
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(content)) !== null) {
    parts.push(content.slice(last, m.index));
    attachments.push({ name: m[1], url: m[2] });
    last = m.index + m[0].length;
  }
  parts.push(content.slice(last));
  return { body: parts.join("").trim(), attachments };
}

/** Reconstruye la cadena de adjuntos para volver a guardarla junto al cuerpo. */
export function attachmentsToLines(attachments: CommentAttachmentRef[]): string {
  return attachments.map((a) => `📎 [${a.name}](${a.url})`).join("\n");
}

const RICH_TAG_RE =
  /<(?:p|br|strong|b|em|i|u|s|ul|ol|li|a|span|h[1-6]|blockquote|code|pre)\b[^>]*>/i;

/** Heurística: ¿el cuerpo es HTML enriquecido (y no texto plano heredado)? */
export function isRichHtml(body: string): boolean {
  return RICH_TAG_RE.test(body);
}

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "ul", "ol", "li", "a", "span", "h1", "h2", "h3",
  "blockquote", "code", "pre",
];
const ALLOWED_ATTR = [
  "href", "target", "rel", "class",
  "data-type", "data-id", "data-label", "data-mention-suggestion-char",
];

/** Sanitiza el HTML del comentario permitiendo solo formato básico y @menciones. */
export function sanitizeCommentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/)/i,
  });
}

/** ¿El HTML del editor está efectivamente vacío (sin texto ni menciones)? */
export function richTextIsEmpty(html: string): boolean {
  if (!html) return true;
  if (/data-type="mention"/.test(html)) return false;
  const text = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
  return text.length === 0;
}

/** Texto plano del comentario (sin adjuntos ni HTML) para vistas previas/notificaciones. */
export function commentPlainText(content: string): string {
  const { body } = parseComment(content);
  if (!isRichHtml(body)) return body.trim();
  const withSpaces = body
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ");
  const stripped = withSpaces.replace(/<[^>]+>/g, "");
  let decoded = stripped;
  if (typeof document !== "undefined") {
    const el = document.createElement("textarea");
    el.innerHTML = stripped;
    decoded = el.value;
  }
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Renderiza el cuerpo (ya separado de adjuntos): HTML enriquecido sanitizado,
 * o texto plano heredado con @menciones resaltadas.
 */
export function CommentTextBody({
  body,
  keyPrefix,
  knownNames,
}: {
  body: string;
  keyPrefix: string;
  knownNames?: string[];
}): ReactNode {
  if (!body) return null;
  if (isRichHtml(body)) {
    return (
      <div
        className="comment-rich"
        // Sanitizado con DOMPurify (solo formato básico + menciones).
        dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(body) }}
      />
    );
  }
  return (
    <div className="whitespace-pre-wrap break-words">
      {renderTextWithMentionHighlights(body, keyPrefix, { knownNames })}
    </div>
  );
}
