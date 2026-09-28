/**
 * Portal del cliente — tickets (M7). Espejo de las funciones SQL
 * `portal_ticket_visible_status()` y `portal_ticket_deadline()`
 * (migración 20260928140400_portal_tickets.sql). El servidor manda; esto sirve
 * para avisar en pantalla ANTES de subir y para etiquetar estados.
 */
export const PORTAL_TICKET_STATUS_MAP = {
  received: "recibido",
  extracted: "en_proceso",
  validated: "en_proceso",
  queued: "en_proceso",
  processing: "en_proceso",
  manual_queue: "en_proceso",
  invoiced: "facturado",
  needs_data: "con_problema",
  unknown_merchant: "con_problema",
  not_deductible: "con_problema",
  duplicate: "con_problema",
  portal_rejected: "con_problema",
  window_expired: "vencido",
} as const;

export type JuunStatus = keyof typeof PORTAL_TICKET_STATUS_MAP;
export type VisibleTicketStatus = "recibido" | "en_proceso" | "facturado" | "con_problema" | "vencido";

export const VISIBLE_STATUS_LABEL: Record<VisibleTicketStatus, string> = {
  recibido: "Recibido",
  en_proceso: "En proceso",
  facturado: "Facturado",
  con_problema: "Con problema",
  vencido: "Vencido",
};

export function visibleStatus(status: string, expiresAt: string | Date | null, now = new Date()): VisibleTicketStatus {
  if (status === "invoiced") return "facturado";
  if (status === "window_expired") return "vencido";
  if (expiresAt && new Date(expiresAt) < now) return "vencido";
  return (PORTAL_TICKET_STATUS_MAP as Record<string, VisibleTicketStatus>)[status] ?? "con_problema";
}

export interface MerchantWindow {
  window_type: "days" | "end_of_month" | "not_applicable";
  window_days: number | null;
}

/** Fecha límite: 23:59:59 hora del centro de México (UTC−6, sin horario de verano desde 2022). */
export function ticketDeadline(m: MerchantWindow | null, receiptDate: string | null): Date | null {
  if (!m || !receiptDate) return null;
  const [y, mo, d] = receiptDate.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const endOfDayMx = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd, 23 + 6, 59, 59));
  if (m.window_type === "days" && m.window_days) {
    const base = new Date(Date.UTC(y, mo - 1, d + m.window_days));
    return endOfDayMx(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
  }
  if (m.window_type === "end_of_month") {
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return endOfDayMx(y, mo, last);
  }
  return null;
}

export const TICKET_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "application/pdf"];
export const TICKET_MAX_BYTES = 10 * 1024 * 1024;

export function ticketFileProblem(file: { name: string; type: string; size: number }): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const okType = TICKET_ACCEPTED_TYPES.includes(file.type) || ["jpg", "jpeg", "png", "heic", "heif", "pdf"].includes(ext);
  if (!okType) return `«${file.name}»: solo se aceptan JPG, PNG, HEIC o PDF.`;
  if (file.size > TICKET_MAX_BYTES) return `«${file.name}» pesa más de 10 MB.`;
  return null;
}
