/**
 * Elimina marcas de dirección Unicode invisibles (RLO, LRO, PDF, etc.) que a veces vienen
 * pegadas desde correos y hacen que el cursor escriba “al revés”.
 */
export function stripBidiControlChars(input: string): string {
  return input.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
}

/**
 * Sanitizes Outlook signature HTML so TipTap can render it without showing
 * raw CSS/markup as text. Removes conditional comments, <style> blocks,
 * VML/XML namespace elements, and Microsoft-specific processing instructions.
 * Keeps basic formatting (p, br, strong, em, a, span, div) with inline styles.
 */
export function sanitizeSignatureHtml(html: string): string {
  if (!html) return "";
  let s = html;
  // Remove Outlook conditional comments <!--[if ...]>...<![endif]-->
  s = s.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "");
  // Remove <style> blocks (their text content shows raw in TipTap)
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove <script> blocks
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  // Remove VML and Office XML namespace elements (v:, o:, w:, m:, etc.)
  s = s.replace(/<\/?[a-z]+:[^>]*>/gi, "");
  // Remove XML processing instructions
  s = s.replace(/<\?xml[^>]*\?>/gi, "");
  // Remove HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Normalize self-closing br
  s = s.replace(/<br\s*\/?>/gi, "<br>");
  return s.trim();
}

export type ComposerAttachment = {
  name: string;
  contentType: string;
  size: number;
  contentBytes: string;
};

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

/** Extensiones habituales de ofimática e imágenes (si el navegador no envía MIME). */
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "zip",
  "rar",
  "7z",
  "msg",
  "eml",
  "rtf",
  "pages",
  "numbers",
  "key",
  "mp4",
  "mov",
  "mp3",
  "wav",
  "xml",
]);

/** Atributo `accept` para FileDropzone en redactar/responder correo (alineado con ALLOWED_EXTENSIONS). */
export const EMAIL_ATTACHMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.rar,.7z,.msg,.eml,.xml";

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Mapa común extensión → MIME cuando `File.type` viene vacío. */
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  msg: "application/vnd.ms-outlook",
  eml: "message/rfc822",
  rtf: "application/rtf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  xml: "application/xml",
};

function resolveContentType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = extensionOf(file.name);
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

function isAllowedAttachment(file: File): boolean {
  const ext = extensionOf(file.name);
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (file.type && file.type.startsWith("image/")) return true;
  if (file.type && file.type.startsWith("video/")) return true;
  if (file.type && file.type.startsWith("audio/")) return true;
  if (file.type === "application/octet-stream" && ext) return ALLOWED_EXTENSIONS.has(ext);
  return false;
}

/** Extrae un correo de un token tipo `correo@x.com` o `Nombre <correo@x.com>`. */
function tokenToEmail(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  const angle = t.match(/<([^<>]+)>\s*$/);
  const candidate = (angle ? angle[1] : t).trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
  return null;
}

export function parseRecipients(value: string): string[] {
  const raw = value.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of raw) {
    const e = tokenToEmail(part);
    if (e) out.push(e);
  }
  return out;
}

/** Lista Graph `toRecipients` / `ccRecipients` → texto para inputs (coma). */
export function graphRecipientsToInputString(recipients: unknown): string {
  if (!Array.isArray(recipients)) return "";
  const parts: string[] = [];
  for (const r of recipients) {
    const ea = (r as { emailAddress?: { address?: string; name?: string } })?.emailAddress;
    const addr = ea?.address?.trim();
    if (!addr) continue;
    const name = ea?.name?.trim();
    parts.push(name ? `${name} <${addr}>` : addr);
  }
  return parts.join(", ");
}

export function emailsToGraphRecipients(emails: string[]): { emailAddress: { address: string } }[] {
  return emails.map((address) => ({ emailAddress: { address } }));
}

/** Si el borrador no trae destinatarios, derivarlos del mensaje original. */
export function fallbackReplyRecipientsFromDetail(
  detail: Record<string, unknown> | null | undefined,
  replyAll: boolean,
): { to: string; cc: string; bcc: string } {
  if (!detail) return { to: "", cc: "", bcc: "" };
  const from = detail.from as { emailAddress?: { address?: string; name?: string } } | undefined;
  const fromLine = graphRecipientsToInputString(
    from?.emailAddress?.address ? [{ emailAddress: from.emailAddress }] : [],
  );
  if (!replyAll) {
    return { to: fromLine, cc: "", bcc: "" };
  }
  const toRec = graphRecipientsToInputString(detail.toRecipients);
  const ccRec = graphRecipientsToInputString(detail.ccRecipients);
  const bccRec = graphRecipientsToInputString(detail.bccRecipients);
  const toMerged = [fromLine, toRec].filter(Boolean).join(", ");
  return { to: toMerged, cc: ccRec, bcc: bccRec };
}

export function validateRecipientGroups(groups: { to: string[]; cc?: string[]; bcc?: string[] }) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set<string>();

  const pushList = (label: string, list: string[]) => {
    for (const email of list) {
      if (!emailRegex.test(email)) {
        return `Correo inválido en ${label}: ${email}`;
      }
      if (seen.has(email)) {
        return `Correo duplicado entre campos: ${email}`;
      }
      seen.add(email);
    }
    return null;
  };

  if (!groups.to.length) return "Agrega al menos un destinatario en Para";
  const toError = pushList("Para", groups.to);
  if (toError) return toError;
  const ccError = pushList("CC", groups.cc || []);
  if (ccError) return ccError;
  const bccError = pushList("BCC", groups.bcc || []);
  if (bccError) return bccError;
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export async function filesToComposerAttachments(files: FileList | File[]): Promise<ComposerAttachment[]> {
  const list = Array.from(files);
  if (!list.length) return [];
  if (list.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Máximo ${MAX_ATTACHMENT_COUNT} adjuntos por correo`);
  }

  const total = list.reduce((acc, file) => acc + file.size, 0);
  if (total > MAX_TOTAL_SIZE_BYTES) {
    throw new Error("El total de adjuntos excede 25MB");
  }

  const attachments: ComposerAttachment[] = [];
  for (const file of list) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`El archivo ${file.name} supera 10MB`);
    }
    if (!isAllowedAttachment(file)) {
      throw new Error(
        `Tipo de archivo no permitido: ${file.name}. Usa documentos, imágenes, zip u ofimática habituales.`,
      );
    }
    const contentType = resolveContentType(file);
    attachments.push({
      name: file.name,
      contentType,
      size: file.size,
      contentBytes: await fileToBase64(file),
    });
  }
  return attachments;
}
