import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { renderTextWithMentionHighlights } from "./renderMentionHighlights";
import { extractDropboxFilenameFromUrl, getDropboxLinkDisplayLabel } from "./dropboxLinkLabel";

/**
 * Etiqueta legible para una URL "pelada" (sin markdown). Evita mostrar tokens
 * de firma (p. ej. `?token=eyJ...`) de URLs firmadas de Supabase Storage.
 */
export function friendlyUrlLabel(url: string): string {
  const raw = url.trim();
  try {
    if (raw.toLowerCase().includes("dropbox.com")) {
      return extractDropboxFilenameFromUrl(raw) ?? getDropboxLinkDisplayLabel(raw);
    }
    const href = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    const u = new URL(href);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
    let name = seg;
    try {
      name = decodeURIComponent(seg);
    } catch {
      /* mantener segmento crudo */
    }
    // Quitar prefijo de timestamp que agregamos al subir (`1712345678901_archivo.png`).
    name = name.replace(/^\d{10,}_/, "");
    return name || u.hostname;
  } catch {
    return raw;
  }
}

// Adjunto/enlace markdown (con o sin 📎 al inicio) o URL pelada.
const TOKEN_RE = /(📎\s*)?\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
// Negrita estilo markdown: **texto**
const BOLD_RE = /\*\*([^*]+)\*\*/g;

/** Aplica menciones a un fragmento de texto plano. */
function renderMentions(text: string, keyPrefix: string): ReactNode[] {
  return renderTextWithMentionHighlights(text, keyPrefix);
}

/** Aplica **negrita** y, dentro, resaltado de menciones. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];
  const out: ReactNode[] = [];
  const re = new RegExp(BOLD_RE.source, "g");
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(...renderMentions(text.slice(last, m.index), `${keyPrefix}-t${idx}`));
    }
    out.push(
      <strong key={`${keyPrefix}-b${idx}`} className="font-semibold text-foreground">
        {renderMentions(m[1], `${keyPrefix}-bt${idx}`)}
      </strong>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  if (last < text.length) {
    out.push(...renderMentions(text.slice(last), `${keyPrefix}-t${idx}`));
  }
  return out;
}

/**
 * Renderiza texto de comentarios/descripciones con:
 *  - adjuntos/enlaces markdown `📎 [nombre](url)` como enlace limpio (sin token),
 *  - URLs peladas convertidas en enlaces con nombre legible,
 *  - **negrita** estilo markdown,
 *  - resaltado de @menciones.
 */
export function renderRichText(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];
  const out: ReactNode[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(...renderInline(text.slice(last, m.index), `${keyPrefix}-i${idx}`));
    }
    const isMarkdownLink = m[3] !== undefined;
    const href = isMarkdownLink ? m[3]! : m[4]!;
    const hasClip = isMarkdownLink ? !!m[1] : false;
    const label = isMarkdownLink ? m[2]! : friendlyUrlLabel(m[4]!);
    out.push(
      <a
        key={`${keyPrefix}-a${idx}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 align-baseline text-xs text-primary hover:underline max-w-full"
        title={label}
      >
        {hasClip ? <span aria-hidden>📎</span> : null}
        <span className="truncate max-w-[220px] align-bottom">{label}</span>
        <ExternalLink className="h-3 w-3 shrink-0 inline" />
      </a>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  if (last < text.length) {
    out.push(...renderInline(text.slice(last), `${keyPrefix}-i${idx}`));
  }
  return out.length > 0 ? out : [text];
}
