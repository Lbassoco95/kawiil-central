import {
  format,
  parseISO,
  isToday,
  isYesterday,
  differenceInMinutes,
  differenceInCalendarDays,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";

// ─── Tipos ─────────────────────────────────────────────────────
export type InferredChipTone =
  | "urgente"
  | "sat"
  | "factura"
  | "cliente"
  | "interno"
  | "notificacion"
  | "ai";

// Dominios de servicios que envían NOTIFICACIONES automáticas (ruido para la bandeja):
// desarrollo, redes sociales y plataformas. Se agrupan aparte de los correos relevantes.
const NOTIFICATION_DOMAINS = [
  "github.com", "githubusercontent.com", "vercel.com", "vercel.app",
  "gitlab.com", "atlassian.net", "atlassian.com", "bitbucket.org",
  "linkedin.com", "substack.com", "medium.com", "twitter.com", "x.com",
  "facebookmail.com", "instagram.com", "slack.com", "notion.so", "figma.com",
  "netlify.com", "sentry.io", "circleci.com", "npmjs.com", "reddit.com",
  "producthunt.com", "calendly.com", "coderabbit.ai", "readthedocs.org",
  "docker.com", "cloudflare.com", "supabase.io", "supabase.com",
];

/** ¿El correo es una notificación automática (bot / plataforma) y no un mensaje relevante? */
export function isNotificationEmail(email: {
  from?: { emailAddress?: { address?: string; name?: string } };
  subject?: string;
}): boolean {
  const addr = (email?.from?.emailAddress?.address || "").toLowerCase();
  const name = (email?.from?.emailAddress?.name || "").toLowerCase();
  const domain = addr.split("@")[1] || "";
  if (!addr && !name) return false;
  // Bots de repositorio (coderabbitai[bot], vercel[bot], dependabot[bot], etc.)
  if (name.includes("[bot]") || /\bbot\b/.test(name)) return true;
  if (NOTIFICATION_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
  return false;
}

export interface EmailChip {
  label: string;
  tone: InferredChipTone;
}

// ─── Infiere chips de etiqueta (URGENTE / SAT / FACTURA…) ──────
export function inferEmailChips(email: {
  from?: { emailAddress?: { address?: string } };
  subject?: string;
  importance?: string;
}): EmailChip[] {
  const chips: EmailChip[] = [];
  const fromAddr = (email?.from?.emailAddress?.address || "").toLowerCase();
  const subject = email?.subject || "";
  const importance = email?.importance;
  const domain = fromAddr.split("@")[1] || "";

  if (
    importance === "high" ||
    /\b(urgente|urgent|requerimiento|obligatori|48h|72h)\b/i.test(subject)
  ) {
    chips.push({ label: "Urgente", tone: "urgente" });
  }
  if (/sat\.gob\.mx|\bsat\.gob\b/.test(domain) || /\bSAT\b/.test(subject)) {
    chips.push({ label: "SAT", tone: "sat" });
  }
  if (
    /factura|invoice|recibo cfe|telmex|microsoft 365 business/i.test(subject)
  ) {
    chips.push({ label: "Factura", tone: "factura" });
  }
  return chips;
}

// ─── Gradientes de avatar (deterministas por dominio) ──────────
const AVATAR_GRADIENTS: Array<[string, string]> = [
  ["hsl(217 91% 55%)", "hsl(217 91% 45%)"],
  ["hsl(142 71% 45%)", "hsl(142 71% 35%)"],
  ["hsl(38 85% 55%)",  "hsl(38 85% 45%)"],
  ["hsl(280 65% 55%)", "hsl(280 65% 45%)"],
  ["hsl(340 80% 55%)", "hsl(340 80% 45%)"],
  ["hsl(197 85% 50%)", "hsl(197 85% 40%)"],
  ["hsl(0 84% 55%)",   "hsl(0 84% 45%)"],
  ["hsl(15 85% 55%)",  "hsl(15 85% 45%)"],
];

export function getAvatarGradient(
  emailAddr?: string,
  displayName?: string
): string {
  const lowEmail = (emailAddr || "").toLowerCase();
  const lowName = (displayName || "").toLowerCase();
  const domain = lowEmail.split("@")[1] || "";

  if (
    /sat\.gob/.test(domain) ||
    /\bsat\b/.test(lowName)
  )
    return `linear-gradient(135deg, ${AVATAR_GRADIENTS[6][0]}, ${AVATAR_GRADIENTS[6][1]})`;

  if (/microsoft\.com|microsoft365|cfe\.gob|telmex/.test(domain))
    return `linear-gradient(135deg, ${AVATAR_GRADIENTS[2][0]}, ${AVATAR_GRADIENTS[2][1]})`;

  if (/dropbox\.com/.test(domain))
    return `linear-gradient(135deg, ${AVATAR_GRADIENTS[0][0]}, ${AVATAR_GRADIENTS[3][0]})`;

  if (/notaria|notario/.test(lowName))
    return `linear-gradient(135deg, ${AVATAR_GRADIENTS[5][0]}, ${AVATAR_GRADIENTS[5][1]})`;

  const src = lowEmail || lowName || "?";
  let hash = 0;
  for (let i = 0; i < src.length; i++)
    hash = (hash + src.charCodeAt(i)) % 2147483647;
  const [a, b] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// ─── Iniciales ─────────────────────────────────────────────────
export function getInitials(name?: string, email?: string): string {
  const source = name || email || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.substring(0, 2).toUpperCase();
}

// ─── Mejor timestamp disponible en respuestas de Graph ─────────
export function emailListTimestamp(email: {
  receivedDateTime?: string;
  sentDateTime?: string;
  createdDateTime?: string;
}): string {
  return (
    email.receivedDateTime ||
    email.sentDateTime ||
    email.createdDateTime ||
    ""
  );
}

// ─── Helpers para abreviaciones de meses en español ────────────
const MONTH_MAP: Record<string, string> = {
  ene: "Ene", feb: "Feb", mar: "Mar", abr: "Abr",
  may: "May", jun: "Jun", jul: "Jul", ago: "Ago",
  sep: "Sep", oct: "Oct", nov: "Nov", dic: "Dic",
};

function capitalizeMonthSpanish(str: string): string {
  return str.replace(/\b([a-záéíóúü]{3,})\b/gi, (m) => {
    const lower = m.toLowerCase();
    return MONTH_MAP[lower] || m.charAt(0).toUpperCase() + m.slice(1);
  });
}

const WEEKDAY_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// ─── Formato de fecha estilo Superhuman ────────────────────────
export function formatEmailDate(dateStr: string): string {
  if (!dateStr?.trim()) return "";
  try {
    const date = parseISO(dateStr);
    if (Number.isNaN(date.getTime())) return "";

    const now = new Date();
    const mins = differenceInMinutes(now, date);

    if (mins < 0) {
      if (isToday(date)) return format(date, "HH:mm");
      return capitalizeMonthSpanish(format(date, "d MMM", { locale: es }));
    }
    if (mins < 60) return mins < 1 ? "Ahora" : `${mins}m`;
    if (isToday(date)) return format(date, "HH:mm");
    if (isYesterday(date)) return "Ayer";

    const calDays = differenceInCalendarDays(
      startOfDay(now),
      startOfDay(date)
    );
    if (calDays >= 2 && calDays <= 6) return WEEKDAY_SHORT_ES[date.getDay()];

    return capitalizeMonthSpanish(format(date, "d MMM", { locale: es }));
  } catch {
    return "";
  }
}

// ─── Date bucket (para separadores de lista) ───────────────────
export type DateBucket = "hoy" | "ayer" | "semana" | "anterior";

export function getDateBucket(
  dateStr: string | undefined,
  now: Date
): DateBucket {
  if (!dateStr) return "anterior";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "anterior";
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = (today - dDay) / 86400000;
  if (diff < 1) return "hoy";
  if (diff < 2) return "ayer";
  if (diff < 7) return "semana";
  return "anterior";
}

export const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  semana: "Esta semana",
  anterior: "Anterior",
};
