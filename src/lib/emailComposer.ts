/**
 * Elimina marcas de dirección Unicode invisibles (RLO, LRO, PDF, etc.) que a veces vienen
 * pegadas desde correos y hacen que el cursor escriba “al revés”.
 */
export function stripBidiControlChars(input: string): string {
  return input.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
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
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/zip",
];

export function parseRecipients(value: string): string[] {
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
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
    if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
      throw new Error(`Tipo de archivo no permitido: ${file.name}`);
    }
    attachments.push({
      name: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      contentBytes: await fileToBase64(file),
    });
  }
  return attachments;
}
