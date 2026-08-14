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

/** Une el cuerpo con las líneas de adjuntos `📎 [n](url)` para persistir. */
export function combineBodyAndAttachments(
  body: string,
  attachments: CommentAttachmentRef[],
): string {
  const lines = attachmentsToLines(attachments);
  if (!lines) return body;
  return body ? `${body}\n${lines}` : lines;
}

// El editor (TipTap) siempre envuelve el contenido en un bloque de nivel superior
// (<p>, <ul>, …) o incluye un <span data-type="mention">. Anclar a eso evita que
// texto plano heredado con `<...>` sueltos (p. ej. "usa <b> para negritas") se
// confunda con HTML y termine sanitizado/borrado.
const RICH_BLOCK_START_RE = /^\s*<(?:p|ul|ol|h[1-3]|blockquote|pre)[\s/>]/i;

/** Heurística: ¿el cuerpo es HTML enriquecido (y no texto plano heredado)? */
export function isRichHtml(body: string): boolean {
  return RICH_BLOCK_START_RE.test(body) || /data-type="mention"/.test(body);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MENTION_WORD_CHAR = /[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ0-9_]/;

/**
 * Convierte un comentario de texto plano heredado a HTML editable, envolviendo
 * las @menciones que coinciden con el directorio en nodos de mención (para que,
 * al editar y guardar, se conserven la asociación y el resaltado).
 */
export function plainTextToEditableHtml(
  text: string,
  profiles: { user_id: string; full_name: string }[],
): string {
  const escaped = escapeHtml(text);
  const names = profiles
    .filter((p) => p.full_name && p.full_name.trim().length > 0)
    .slice()
    .sort((a, b) => b.full_name.length - a.full_name.length);

  const isWord = (ch: string | undefined) => !!ch && MENTION_WORD_CHAR.test(ch);
  let out = "";
  let i = 0;
  while (i < escaped.length) {
    if (escaped[i] === "@" && (i === 0 || !isWord(escaped[i - 1]))) {
      const rest = escaped.slice(i + 1);
      const match = names.find(
        (p) =>
          rest.slice(0, p.full_name.length).toLowerCase() === p.full_name.toLowerCase() &&
          !isWord(rest[p.full_name.length]),
      );
      if (match) {
        const label = escapeHtml(match.full_name);
        out += `<span data-type="mention" class="mention" data-id="${escapeHtml(match.user_id)}" data-label="${label}">@${label}</span>`;
        i += 1 + match.full_name.length;
        continue;
      }
    }
    out += escaped[i];
    i++;
  }
  return `<p>${out.replace(/\n/g, "<br>")}</p>`;
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
