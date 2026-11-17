const EMOJI_NAME = /^[a-z0-9_-]{1,100}$/;
const EMOJI_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
export const SLACK_EMOJI_MAX_BYTES = 128 * 1024;

/** null si el archivo y el nombre sirven para `emoji.add`. */
export function validateSlackEmojiUpload(name: string, file: Pick<File, "type" | "size">): string | null {
  const normalized = name.trim().toLowerCase();
  if (!EMOJI_NAME.test(normalized)) {
    return "El nombre solo puede tener minúsculas, números, guiones y guion bajo.";
  }
  if (!EMOJI_TYPES.has(file.type)) {
    return "Usa una imagen PNG, JPG o GIF.";
  }
  if (file.size <= 0 || file.size > SLACK_EMOJI_MAX_BYTES) {
    return "La imagen debe pesar menos de 128 KB.";
  }
  return null;
}

export function slackEmojiNameFromFile(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export function formatSlackEmojiUploadError(raw: string | undefined): string {
  const error = (raw || "").trim();
  const lower = error.toLowerCase();
  if (!error) return "Slack no aceptó el emoji.";
  if (lower.includes("missing_scope")) {
    return "Falta el permiso para leer emojis. Pulsa «Actualizar permisos Slack» y vuelve a aceptar.";
  }
  if (lower.includes("error_name_taken") || lower.includes("name_taken")) {
    return "Ese nombre ya existe en Slack. Elige otro.";
  }
  if (lower.includes("unknown_method") || lower.includes("not_allowed") || lower.includes("invalid_auth")) {
    return "Slack no dejó crear el emoji con esta sesión. Súbelo en Slack (personalizar workspace) y pulsa Sincronizar: aparecerá aquí.";
  }
  if (lower.includes("emoji_too_large") || lower.includes("too_large")) {
    return "La imagen debe pesar menos de 128 KB.";
  }
  if (lower.includes("invalid_emoji_type") || lower.includes("invalid_name")) {
    return "Revisa el nombre y que el archivo sea PNG, JPG o GIF.";
  }
  return error;
}
