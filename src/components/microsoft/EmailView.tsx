import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useId,
  useMemo,
  type ComponentType,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useOutlookEmails,
  useEmailDetail,
  useReplyEmail,
  useForwardEmail,
  useMarkEmailRead,
  useMarkEmailUnread,
  useArchiveEmail,
  useMailFolders,
  useEmailConversation,
  useCreateReplyDraft,
  useCreateForwardDraft,
  useSendDraft,
  useCreateMailFolder,
  useMoveEmail,
  useDeleteEmail,
  useEmailAttachments,
  useUnreadEmailCount,
  useOutlookCategories,
  useEmailDetailPrefetch,
  INBOX_UNREAD_QUERY_KEY,
  SCHEDULED_MAIL_JOBS_QUERY_KEY,
  mailFoldersRootFallbackUserMessage,
} from "@/hooks/useMicrosoft";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useResolvedEmailHtml } from "@/hooks/useResolvedEmailHtml";
import {
  fetchMessageAttachmentBlob,
  inferMimeFromFileName,
  type OutlookAttachment,
} from "@/lib/outlookEmailMedia";
import {
  buildEmailSheetPreview,
  EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES,
  type EmailSheetPreviewData,
} from "@/lib/emailAttachmentSheetPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, Mail, MailOpen, Paperclip, Loader2, Reply, ReplyAll, Forward, Send,
  Sparkles, Languages, ListTodo, Inbox, SendHorizonal,
  FileText, Trash2, AlertCircle, FolderOpen, ChevronDown, ChevronRight,
  FolderPlus, X, Check, FolderInput, Archive, Star, MoreHorizontal,
  Keyboard, ArrowDown, ChevronsLeft, ChevronsRight, Maximize2, List, ListOrdered, RefreshCw,
  Eye, Download, CalendarClock, Copy, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  GripVertical, ShieldCheck,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  EMAIL_FOLDER_ORDER_ROOT_KEY,
  defaultFolderOrdersFromTree,
  mergeSiblingOrder,
  readEmailFolderOrder,
  writeEmailFolderOrder,
} from "@/lib/emailFolderOrder";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import DOMPurify from "dompurify";
import { sanitizeEmailBodyForIframe } from "@/lib/sanitizeEmailBodyForIframe";
import {
  formatDistanceToNow,
  parseISO,
  format,
  isToday,
  isYesterday,
  differenceInMinutes,
  differenceInCalendarDays,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import { CreateTaskFromEmailDialog } from "./CreateTaskFromEmailDialog";
import { CreateMailRuleDialog } from "./CreateMailRuleDialog";
import { SendEmailToSlackDialog } from "./SendEmailToSlackDialog";
import { MessageSquare } from "lucide-react";
import { EmailAIAssistant } from "./EmailAIAssistant";
import { EmailInboxAiPanel } from "./EmailInboxAiPanel";
import { EmailKawiilCard } from "./EmailKawiilCard";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { ReplyForwardDialog } from "./ReplyForwardDialog";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { buildThreadContextForAi } from "@/lib/emailThreadContext";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  emailsToGraphRecipients,
  fallbackReplyRecipientsFromDetail,
  filesToComposerAttachments,
  graphRecipientsToInputString,
  parseRecipients,
  validateRecipientGroups,
  type ComposerAttachment,
} from "@/lib/emailComposer";
import {
  SCHEDULED_MAIL_FOLDER_DISPLAY_NAME,
  ensureScheduledMailFolderId,
  isScheduledMailFolderDisplayName,
  moveDraftToScheduledFolder,
  reconcilePendingScheduledDraftsToFolder,
} from "@/lib/scheduledMailFolder";

type EmailAction = "reply" | "reply-all" | "forward" | null;

function normFolderKey(displayName: string) {
  return displayName.toLowerCase().replace(/\s/g, "");
}

function scheduleMailInsertErrorText(err: unknown): string {
  if (err instanceof Error && err.message?.trim()) {
    const hint =
      "hint" in err && typeof (err as { hint?: string }).hint === "string"
        ? (err as { hint: string }).hint.trim()
        : "";
    const base = err.message.trim();
    if (hint && !base.toLowerCase().includes(hint.toLowerCase())) return `${base}. ${hint}`;
    return base;
  }
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return "";
}

function humanizeScheduleMailError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("does not exist") || t.includes("no existe la relación")) {
    return "Envíos programados: la tabla no existe en Supabase. Aplica las migraciones del repositorio (scheduled_mail_jobs) y vuelve a intentar.";
  }
  if (t.includes("row-level security")) {
    return "No se pudo guardar el envío programado (políticas de seguridad). Cierra sesión y entra de nuevo.";
  }
  if (t.includes("permission denied") || t.includes("permiso denegado")) {
    return "No tienes permiso para programar envíos. Si eres administrador, aplica la migración de permisos en scheduled_mail_jobs.";
  }
  return raw;
}

function getFolderIcon(displayName: string) {
  const key = normFolderKey(displayName);
  if (isScheduledMailFolderDisplayName(displayName)) return CalendarClock;
  if (key.includes("inbox") || key.includes("bandeja")) return Inbox;
  if (key.includes("sent") || key.includes("enviado")) return SendHorizonal;
  if (key.includes("draft") || key.includes("borrador")) return FileText;
  if (key.includes("deleted") || key.includes("eliminad")) return Trash2;
  if (key.includes("junk") || key.includes("spam") || key.includes("correo no deseado")) return AlertCircle;
  if (key.includes("archive") || key.includes("archiv")) return Archive;
  return FolderOpen;
}

function getFolderLabel(displayName: string) {
  const key = normFolderKey(displayName);
  if (key.includes("inbox") || key.includes("bandejadeentrada")) return "Bandeja de entrada";
  if (key.includes("sentitems") || key.includes("elementosenviados")) return "Enviados";
  if (isScheduledMailFolderDisplayName(displayName)) return "Programados";
  if (key.includes("drafts") || key.includes("borradores")) return "Borradores";
  if (key.includes("deleteditems") || key.includes("elementoseliminados")) return "Eliminados";
  if (key.includes("junkemail") || key.includes("correonodeseado")) return "Spam";
  if (key.includes("archive") || key.includes("archiv")) return "Archivo";
  return displayName;
}

const WELL_KNOWN_ORDER = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail"];

function wellKnownSortIndex(f: any): number | null {
  const wk = String(f.wellKnownFolderName || f.wellKnownName || "").toLowerCase();
  const ordIdx = WELL_KNOWN_ORDER.indexOf(wk);
  if (ordIdx >= 0) return ordIdx;
  const key = normFolderKey(String(f.displayName || ""));
  if (WELL_KNOWN_ORDER.some((wkPart) => key.includes(wkPart))) {
    for (let i = 0; i < WELL_KNOWN_ORDER.length; i++) {
      if (key.includes(WELL_KNOWN_ORDER[i])) return i;
    }
  }
  if (key.includes("inbox") || key.includes("bandeja")) return 0;
  if (key.includes("sent") || key.includes("enviado")) return 1;
  if (key.includes("draft") || key.includes("borrador")) return 2;
  if (key.includes("deleted") || key.includes("eliminad")) return 3;
  if (key.includes("junk") || key.includes("spam") || key.includes("correonodeseado")) return 4;
  return null;
}

/** Orden dentro de un mismo nivel (well-known primero, luego alfabético). */
function sortFolderRowsAtLevel(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const ia = wellKnownSortIndex(a);
    const ib = wellKnownSortIndex(b);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    if (ia != null && ib == null) return -1;
    if (ia == null && ib != null) return 1;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""), "es", { sensitivity: "base" });
  });
}

function normalizeMailFolderId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s || null;
}

function buildFolderTreeData(folders: any[]): {
  roots: any[];
  childrenMap: Map<string, any[]>;
  byId: Map<string, any>;
} {
  const list = (folders || [])
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      const id = normalizeMailFolderId((f as { id?: unknown }).id);
      if (!id) return null;
      const rawPid = (f as { parentFolderId?: unknown }).parentFolderId;
      const parentFolderId =
        rawPid === null || rawPid === undefined
          ? undefined
          : normalizeMailFolderId(rawPid) ?? undefined;
      return { ...f, id, parentFolderId };
    })
    .filter(Boolean) as any[];

  const byId = new Map<string, any>();
  for (const f of list) byId.set(f.id, f);
  const childrenMap = new Map<string, any[]>();
  const roots: any[] = [];
  for (const f of list) {
    const pid = f.parentFolderId;
    if (typeof pid === "string" && byId.has(pid)) {
      const arr = childrenMap.get(pid) ?? [];
      arr.push(f);
      childrenMap.set(pid, arr);
    } else {
      roots.push(f);
    }
  }
  /** Ciclo o datos raros de Graph: sin raíces pero hay filas → mostrar todas como lista plana. */
  if (roots.length === 0 && list.length > 0) {
    sortFolderRowsAtLevel(list);
    return { roots: list, childrenMap: new Map(), byId };
  }
  sortFolderRowsAtLevel(roots);
  for (const [k, arr] of childrenMap.entries()) {
    childrenMap.set(k, sortFolderRowsAtLevel(arr));
  }
  return { roots, childrenMap, byId };
}

function computeFolderSearchVisibility(
  roots: any[],
  childrenMap: Map<string, any[]>,
  query: string,
  allFolderIds: string[],
  byId: Map<string, any>,
): Set<string> {
  const q = query.trim().toLowerCase();
  const visible = new Set<string>();
  if (roots.length === 0) {
    if (!q) return new Set(allFolderIds);
    for (const id of allFolderIds) {
      const node = byId.get(id);
      if (!node) continue;
      const label = getFolderLabel(String(node.displayName || "")).toLowerCase();
      const raw = String(node.displayName || "").toLowerCase();
      const pathStr = folderPathFromId(id, byId).toLowerCase();
      if (label.includes(q) || raw.includes(q) || pathStr.includes(q)) visible.add(id);
    }
    return visible;
  }
  function dfs(node: any): boolean {
    const label = getFolderLabel(String(node.displayName || "")).toLowerCase();
    const raw = String(node.displayName || "").toLowerCase();
    const selfMatch = !q || label.includes(q) || raw.includes(q);
    let anyChild = false;
    for (const ch of childrenMap.get(node.id) ?? []) {
      if (dfs(ch)) anyChild = true;
    }
    if (selfMatch || anyChild) visible.add(node.id);
    return selfMatch || anyChild;
  }
  for (const r of roots) dfs(r);
  if (visible.size === 0 && allFolderIds.length > 0 && !q) {
    return new Set(allFolderIds);
  }
  return visible;
}

/** Ruta corta para tooltips y mover (ej. Bandeja · Clientes). */
function folderPathFromId(folderId: string, byId: Map<string, any>): string {
  const segments: string[] = [];
  let cur: any = byId.get(folderId);
  for (let i = 0; i < 48 && cur; i++) {
    segments.unshift(getFolderLabel(String(cur.displayName || "")));
    const pid = cur.parentFolderId;
    if (typeof pid !== "string" || !byId.has(pid)) break;
    cur = byId.get(pid);
  }
  return segments.join(" · ");
}

/** Riel de iconos: marca activo si la carpeta seleccionada es esta raíz o una subcarpeta bajo ella. */
function folderRailRootIsActive(
  rootId: string,
  selectedId: string,
  byId: Map<string, any>,
): boolean {
  if (selectedId === rootId) return true;
  let cur: any = byId.get(selectedId);
  for (let i = 0; i < 64 && cur; i++) {
    const pid = cur.parentFolderId;
    if (pid === rootId) return true;
    if (typeof pid !== "string" || !byId.has(pid)) break;
    cur = byId.get(pid);
  }
  return false;
}

/**
 * Badges del listado de carpetas: misma fuente que el sidebar para Inbox (`useUnreadEmailCount` / Graph inbox).
 * Borradores: total; Spam: no leídos; resto sin badge.
 */
function getFolderSidebarBadge(folder: any, inboxUnread: number): number | null {
  const wk = String(folder.wellKnownFolderName || "").toLowerCase();
  const nameKey = (folder.displayName || "").toLowerCase().replace(/\s/g, "");

  const isInbox =
    wk === "inbox" || nameKey.includes("inbox") || nameKey.includes("bandejadeentrada");
  if (isInbox) return inboxUnread > 0 ? inboxUnread : null;

  const isDrafts =
    wk === "drafts" || nameKey.includes("draft") || nameKey.includes("borrador");
  if (isDrafts) {
    const t = folder.totalItemCount ?? 0;
    return t > 0 ? t : null;
  }

  const isJunk =
    wk === "junkemail" ||
    nameKey.includes("junk") ||
    nameKey.includes("spam") ||
    nameKey.includes("correonodeseado");
  if (isJunk) {
    const u = folder.unreadItemCount ?? 0;
    return u > 0 ? u : null;
  }

  return null;
}

function sortFolders(folders: any[]) {
  return sortFolderRowsAtLevel([...(folders || [])]);
}

/** Abreviaturas de día (getDay: 0=Dom … 6=Sáb), estilo bandeja tipo Superhuman */
const WEEKDAY_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

function capitalizeMonthSpanish(formatted: string): string {
  return formatted.replace(/^(\d+)\s+(.+)$/, (_, day: string, month: string) => {
    const m = month.replace(/\.$/, "");
    return `${day} ${m.charAt(0).toUpperCase()}${m.slice(1)}`;
  });
}

/**
 * Timestamps estilo Superhuman para `receivedDateTime` / `sentDateTime` (ISO 8601).
 */
function formatEmailDate(dateStr: string): string {
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
    if (mins < 60) {
      return mins < 1 ? "Ahora" : `${mins}m`;
    }
    if (isToday(date)) {
      return format(date, "HH:mm");
    }
    if (isYesterday(date)) {
      return "Ayer";
    }

    const calDays = differenceInCalendarDays(startOfDay(now), startOfDay(date));
    if (calDays >= 2 && calDays <= 6) {
      return WEEKDAY_SHORT_ES[date.getDay()];
    }

    return capitalizeMonthSpanish(format(date, "d MMM", { locale: es }));
  } catch {
    return "";
  }
}

/** Mejor instante disponible en listados Graph (bandeja Enviados suele usar sentDateTime). */
function emailListTimestamp(email: { receivedDateTime?: string; sentDateTime?: string; createdDateTime?: string }) {
  return email.receivedDateTime || email.sentDateTime || email.createdDateTime || "";
}

function getInitials(name?: string, email?: string): string {
  const source = name || email || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.substring(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
  "bg-pink-500", "bg-sky-500", "bg-rose-500", "bg-teal-500",
];

function getAvatarColor(email?: string): string {
  if (!email) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash + email.charCodeAt(i)) % 2147483647;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// ─── Avatar gradiente (mock v2.4) ─────────────────────────────
const AVATAR_GRADIENTS: Array<[string, string]> = [
  ["hsl(217 91% 55%)", "hsl(217 91% 45%)"],
  ["hsl(142 71% 45%)", "hsl(142 71% 35%)"],
  ["hsl(38 85% 55%)", "hsl(38 85% 45%)"],
  ["hsl(280 65% 55%)", "hsl(280 65% 45%)"],
  ["hsl(340 80% 55%)", "hsl(340 80% 45%)"],
  ["hsl(197 85% 50%)", "hsl(197 85% 40%)"],
  ["hsl(0 84% 55%)", "hsl(0 84% 45%)"],
  ["hsl(15 85% 55%)", "hsl(15 85% 45%)"],
];

/** Devuelve un gradient CSS determinista por dominio/email. SAT y dominios "marca" se forzan a paleta acorde al mock. */
function getAvatarGradient(emailAddr?: string, displayName?: string): string {
  const lowEmail = (emailAddr || "").toLowerCase();
  const lowName = (displayName || "").toLowerCase();
  const domain = lowEmail.split("@")[1] || "";
  if (/sat\.gob/.test(domain) || /\bsat\b/.test(lowName)) return `linear-gradient(135deg, ${AVATAR_GRADIENTS[6][0]}, ${AVATAR_GRADIENTS[6][1]})`;
  if (/microsoft\.com|microsoft365|cfe\.gob|telmex/.test(domain)) return `linear-gradient(135deg, ${AVATAR_GRADIENTS[2][0]}, ${AVATAR_GRADIENTS[2][1]})`;
  if (/dropbox\.com/.test(domain)) return `linear-gradient(135deg, ${AVATAR_GRADIENTS[0][0]}, ${AVATAR_GRADIENTS[3][0]})`;
  if (/notaria|notario/.test(lowName)) return `linear-gradient(135deg, ${AVATAR_GRADIENTS[5][0]}, ${AVATAR_GRADIENTS[5][1]})`;
  const src = lowEmail || lowName || "?";
  let hash = 0;
  for (let i = 0; i < src.length; i++) hash = (hash + src.charCodeAt(i)) % 2147483647;
  const [a, b] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// ─── Etiquetas inferidas (URGENTE / SAT / FACTURA) ────────────
type InferredChipTone = "urgente" | "sat" | "factura" | "cliente" | "interno" | "ai";

function inferEmailChips(email: any): Array<{ label: string; tone: InferredChipTone }> {
  const chips: Array<{ label: string; tone: InferredChipTone }> = [];
  const fromAddr = (email?.from?.emailAddress?.address || "").toLowerCase();
  const subject = (email?.subject || "");
  const importance = email?.importance;
  const domain = fromAddr.split("@")[1] || "";
  if (importance === "high" || /\b(urgente|urgent|requerimiento|obligatori|48h|72h)\b/i.test(subject)) {
    chips.push({ label: "Urgente", tone: "urgente" });
  }
  if (/sat\.gob\.mx|\bsat\.gob\b/.test(domain) || /\bSAT\b/.test(subject)) {
    chips.push({ label: "SAT", tone: "sat" });
  }
  if (/factura|invoice|recibo cfe|telmex|microsoft 365 business/i.test(subject)) {
    chips.push({ label: "Factura", tone: "factura" });
  }
  return chips;
}

const INFERRED_CHIP_STYLES: Record<InferredChipTone, string> = {
  urgente: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800/40",
  sat: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border-red-200/60 dark:border-red-800/30",
  factura: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40",
  cliente: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/40",
  interno: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40",
  ai: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/40",
};

// ─── Date buckets (Hoy · Ayer · Semana pasada · …) ────────────
type DateBucket = "hoy" | "ayer" | "semana" | "anterior";

function getDateBucket(dateStr: string | undefined, now: Date): DateBucket {
  if (!dateStr) return "anterior";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "anterior";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (t === today) return "hoy";
  if (t === today - dayMs) return "ayer";
  if (today - t < 7 * dayMs) return "semana";
  return "anterior";
}

function getBucketLabel(bucket: DateBucket, sampleDate: Date | null): string {
  if (bucket === "hoy" && sampleDate) {
    const dayName = WEEKDAY_SHORT_ES[sampleDate.getDay()];
    const dn = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][sampleDate.getDay()] || dayName;
    const monthName = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][sampleDate.getMonth()];
    return `Hoy · ${dn} ${sampleDate.getDate()} de ${monthName}`;
  }
  if (bucket === "ayer") return "Ayer";
  if (bucket === "semana") return "Esta semana";
  return "Anteriores";
}

/** Versión UI del lector (visible en inspección; útil para comprobar deploy en Lovable/preview). */
export const EMAIL_VIEW_LAYOUT_VERSION = "2026.04-readerv23-reader-fit";

type AttachmentPreviewState = {
  url: string;
  name: string;
  kind: "image" | "pdf" | "docx" | "sheet" | "other";
  /** Requerido para `docx` y `sheet` (Mammoth / SheetJS). */
  sourceBlob?: Blob;
};

function triggerBlobDownload(blobUrl: string, filename: string) {
  const a = window.document.createElement("a");
  a.href = blobUrl;
  a.download = filename.trim() || "adjunto";
  a.rel = "noopener";
  window.document.body.appendChild(a);
  a.click();
  window.document.body.removeChild(a);
}

const LS_EMAIL_FOLDERS_COLLAPSED = "kawiil-email-folders-collapsed";
const LS_EMAIL_FOLDERS_EXPANDED_IDS = "kawiil-email-folders-expanded-ids";
/** Una sola vez por navegador: expande Bandeja de entrada si tiene subcarpetas (paridad con Outlook). */
const LS_EMAIL_FOLDERS_INBOX_AUTO_EXPAND_DONE = "kawiil-email-folders-inbox-auto-expand-v1";
/** Una vez por sesión de navegador: aviso fallback carpetas solo raíz (evita spam de toasts). */
const SESSION_LS_MAIL_FOLDERS_ROOT_FALLBACK_WARN = "kawiil-email-toast-mail-folders-root-fallback-done";

function readExpandedFolderIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LS_EMAIL_FOLDERS_EXPANDED_IDS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function readFoldersCollapsedPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(LS_EMAIL_FOLDERS_COLLAPSED);
    // default collapsed (Superhuman style) unless user explicitly expanded
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

type EmailFolderRowBundle = {
  Icon: ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  folderBadge: number | null;
  dragHandlers: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
  onSelect: () => void;
};

type EmailFolderTreeItemProps = {
  folder: any;
  depth: number;
  /** Clave en `byParent` del orden guardado (`__root__` o id del padre). */
  parentListKey: string;
  orderedFolderChildrenMap: Map<string, any[]>;
  folderVisibleIds: Set<string>;
  expandedFolderIds: Set<string>;
  setExpandedFolderIds: Dispatch<SetStateAction<Set<string>>>;
  dragOverFolderId: string | null;
  folderRow: (folder: any) => EmailFolderRowBundle;
};

function EmailFolderTreeItem({
  folder,
  depth,
  parentListKey,
  orderedFolderChildrenMap,
  folderVisibleIds,
  expandedFolderIds,
  setExpandedFolderIds,
  dragOverFolderId,
  folderRow,
}: EmailFolderTreeItemProps) {
  const orphanStableId = useId();
  const folderIdSafe = typeof folder?.id === "string" ? folder.id : "";
  const visible = !!(folderIdSafe && folderVisibleIds.has(folderIdSafe));

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: folderIdSafe || `email-folder-ph:${orphanStableId}`,
    disabled: !visible || !folderIdSafe,
    data: { parentKey: parentListKey, type: "email-folder-sidebar" },
  });

  if (!visible || !folderIdSafe || !folder) return null;

  const allKids = orderedFolderChildrenMap.get(folder.id) ?? [];
  const kids = allKids.filter((k: any) => folderVisibleIds.has(k.id));
  const hasChildren = kids.length > 0;
  const expanded = expandedFolderIds.has(folder.id);
  const { Icon, label, isActive, folderBadge, dragHandlers, onSelect } = folderRow(folder);
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const rowClass =
    "flex min-w-0 flex-1 items-center gap-2 rounded-none py-2 pl-2 pr-1 text-left text-sm transition-all hover:bg-accent/60";

  const rowInner = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {folderBadge != null && folderBadge > 0 && (
        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-bold tabular-nums bg-primary/15 text-primary">
          {folderBadge}
        </Badge>
      )}
    </>
  );

  const grip = (
    <button
      type="button"
      className="inline-flex h-9 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 active:cursor-grabbing"
      aria-label="Arrastrar para reordenar carpeta"
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );

  if (!hasChildren) {
    return (
      <div
        ref={setNodeRef}
        style={sortableStyle}
        className={cn("min-w-0", isDragging && "opacity-60")}
        {...attributes}
      >
        <div className="flex min-w-0 items-stretch" style={{ marginLeft: depth * 10 }}>
          {grip}
          <span className="inline-flex w-5 shrink-0" aria-hidden />
          <button
            type="button"
            className={cn(
              rowClass,
              isActive && "border-l-2 border-primary bg-accent font-medium text-accent-foreground",
              dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary",
            )}
            onClick={onSelect}
            {...dragHandlers}
          >
            {rowInner}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={cn("min-w-0", isDragging && "opacity-60")}
      {...attributes}
    >
      <Collapsible
        open={expanded}
        onOpenChange={(open) => {
          setExpandedFolderIds((prev) => {
            const n = new Set(prev);
            if (open) n.add(folder.id);
            else n.delete(folder.id);
            return n;
          });
        }}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-stretch" style={{ marginLeft: depth * 10 }}>
            {grip}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60"
                aria-label={expanded ? "Contraer subcarpetas" : "Expandir subcarpetas"}
              >
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
              </button>
            </CollapsibleTrigger>
            <button
              type="button"
              className={cn(
                rowClass,
                isActive && "border-l-2 border-primary bg-accent font-medium text-accent-foreground",
                dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary",
              )}
              onClick={onSelect}
              {...dragHandlers}
            >
              {rowInner}
            </button>
          </div>
          <CollapsibleContent>
            <div className="min-w-0 border-l border-border/40 ml-[calc(0.625rem+10px)]">
              <SortableContext items={kids.map((k: any) => k.id)} strategy={verticalListSortingStrategy}>
                {kids.map((ch: any) => (
                  <EmailFolderTreeItem
                    key={ch.id}
                    folder={ch}
                    depth={depth + 1}
                    parentListKey={folder.id}
                    orderedFolderChildrenMap={orderedFolderChildrenMap}
                    folderVisibleIds={folderVisibleIds}
                    expandedFolderIds={expandedFolderIds}
                    setExpandedFolderIds={setExpandedFolderIds}
                    dragOverFolderId={dragOverFolderId}
                    folderRow={folderRow}
                  />
                ))}
              </SortableContext>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

export function EmailView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [aiInboxOpen, setAiInboxOpen] = useState(false);
  const [emailAction, setEmailAction] = useState<EmailAction>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardCc, setForwardCc] = useState("");
  const [forwardBcc, setForwardBcc] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replyBcc, setReplyBcc] = useState("");
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [quickTaskEmail, setQuickTaskEmail] = useState<{ id: string; subject?: string; senderName?: string; senderEmail?: string; bodyPreview?: string; receivedDateTime?: string } | null>(null);
  const [sendToSlackOpen, setSendToSlackOpen] = useState(false);
  const [mailRuleDialogOpen, setMailRuleDialogOpen] = useState(false);
  const [aiCardOpen, setAiCardOpen] = useState(false);
  const [emailAiSummary, setEmailAiSummary] = useState<{
    summary: string;
    suggestedAction: string | null;
  } | null>(null);
  const [quickAIPrompt, setQuickAIPrompt] = useState<string | null>(null);
  const [detailAiPanel, setDetailAiPanel] = useState<null | "summarize" | "translate">(null);
  const [detailAiLoading, setDetailAiLoading] = useState(false);
  const [detailAiText, setDetailAiText] = useState("");
  const [detailAiTranslateTarget, setDetailAiTranslateTarget] = useState<"en" | "es" | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftHtml, setDraftHtml] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const [moveFolderSearch, setMoveFolderSearch] = useState("");
  const [aiSuggestedFolderId, setAiSuggestedFolderId] = useState<string | null>(null);
  const [aiSuggestingFolder, setAiSuggestingFolder] = useState(false);
  const [movePopoverCreateOpen, setMovePopoverCreateOpen] = useState(false);
  const [moveFolderCreateName, setMoveFolderCreateName] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState | null>(null);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [requestDeliveryReceipt, setRequestDeliveryReceipt] = useState(false);
  const [requestReadReceipt, setRequestReadReceipt] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  /** Escritorio: panel de carpetas estrecho solo con iconos */
  const [foldersCollapsed, setFoldersCollapsed] = useState(readFoldersCollapsedPref);
  /** Escritorio: oculta la lista al leer un correo para ampliar el lector */
  const [listPaneCollapsed, setListPaneCollapsed] = useState(false);
  /** Filtro rápido sobre la lista (mock v2.4 — chips arriba de la lista) */
  const [listFilter, setListFilter] = useState<"all" | "unread" | "attachments" | "sat" | "facturas">("all");
  const [folderSidebarSearch, setFolderSidebarSearch] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(readExpandedFolderIds);
  const [folderRailPickerOpen, setFolderRailPickerOpen] = useState(false);
  const [folderRailPickerQuery, setFolderRailPickerQuery] = useState("");
  /** Orden manual de carpetas por padre (localStorage); no se sincroniza con Outlook. */
  const [folderOrderByParent, setFolderOrderByParent] = useState<Record<string, string[]>>({});
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [lastBulkSelectedIdx, setLastBulkSelectedIdx] = useState<number>(-1);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveFolderSearch, setBulkMoveFolderSearch] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const resetAction = useCallback(() => {
    setEmailAction(null);
    setDraftHtml("");
    setDraftId(null);
    setForwardTo("");
    setForwardCc("");
    setForwardBcc("");
    setReplyTo("");
    setReplyCc("");
    setReplyBcc("");
    setReplyFiles([]);
    setRequestDeliveryReceipt(false);
    setRequestReadReceipt(false);
  }, []);

  const { data: outlookCategories = [] } = useOutlookCategories();
  const categoryColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of outlookCategories as any[]) {
      const name = c?.displayName;
      if (!name) continue;
      m.set(name, outlookCategoryColorToHsl(c?.color));
    }
    return m;
  }, [outlookCategories]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LS_EMAIL_FOLDERS_COLLAPSED, foldersCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [foldersCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LS_EMAIL_FOLDERS_EXPANDED_IDS, JSON.stringify([...expandedFolderIds]));
    } catch {
      /* ignore */
    }
  }, [expandedFolderIds]);

  useEffect(() => {
    if (!selectedEmailId) setListPaneCollapsed(false);
    setEmailAiSummary(null);
  }, [selectedEmailId]);

  useEffect(() => {
    if (!user?.id) return;
    setFolderOrderByParent(readEmailFolderOrder(user.id));
  }, [user?.id]);

  const { data: mailFoldersData } = useMailFolders();
  const folders = (mailFoldersData?.folders ?? []) as any[];
  const draftsFolderId = useMemo(() => {
    const f = (folders as { id?: string; displayName?: string; wellKnownName?: string; wellKnownFolderName?: string }[]).find((x) => {
      const wk = String(x.wellKnownFolderName || x.wellKnownName || "").toLowerCase();
      if (wk === "drafts") return true;
      const dn = normFolderKey(String(x.displayName || ""));
      return dn.includes("draft") || dn.includes("borrador");
    });
    return typeof f?.id === "string" ? f.id : undefined;
  }, [folders]);

  /** Reubica borradores con envío `pending` que sigan en Borradores (trabajos viejos o si falló el move). */
  useEffect(() => {
    if (!user?.id) return;
    const tid = window.setTimeout(() => {
      void reconcilePendingScheduledDraftsToFolder(user.id, queryClient);
    }, 2000);
    return () => window.clearTimeout(tid);
  }, [user?.id, queryClient]);

  useEffect(() => {
    if (!user?.id || !draftsFolderId) return;
    if (selectedFolderId !== draftsFolderId) return;
    const tid = window.setTimeout(() => {
      void reconcilePendingScheduledDraftsToFolder(user.id, queryClient);
    }, 500);
    return () => window.clearTimeout(tid);
  }, [user?.id, draftsFolderId, selectedFolderId, queryClient]);

  const { data: inboxUnread = 0 } = useUnreadEmailCount();
  const emailsQuery = useOutlookEmails(selectedFolderId, debouncedSearch || undefined);
  const {
    data: emailDetail,
    isLoading: detailLoading,
    isError: detailQueryFailed,
    error: detailQueryError,
    refetch: refetchEmailDetail,
  } = useEmailDetail(selectedEmailId);
  const {
    data: threadEmails = [],
    isLoading: threadConvLoading,
    isFetching: threadConvFetching,
  } = useEmailConversation(emailDetail?.conversationId || null);
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();
  const prefetchEmailDetail = useEmailDetailPrefetch();
  const markRead = useMarkEmailRead();
  const markUnread = useMarkEmailUnread();
  const archiveEmail = useArchiveEmail();
  const createReplyDraft = useCreateReplyDraft();
  const createForwardDraft = useCreateForwardDraft();
  const sendDraft = useSendDraft();
  const createMailFolder = useCreateMailFolder();
  const moveEmail = useMoveEmail();
  const deleteEmail = useDeleteEmail();
  const { data: attachments = [] } = useEmailAttachments(selectedEmailId ?? undefined);
  const { html: resolvedEmailHtml, loading: bodyCidLoading } = useResolvedEmailHtml(
    selectedEmailId ?? undefined,
    emailDetail?.body?.contentType === "html" ? emailDetail.body.content : undefined,
    attachments,
  );

  const iframeSafeEmailHtml = useMemo(
    () => sanitizeEmailBodyForIframe(resolvedEmailHtml || ""),
    [resolvedEmailHtml],
  );

  const allEmails = useMemo(() => {
    if (!emailsQuery.data?.pages) return [];
    return emailsQuery.data.pages.flatMap((p) => p.emails);
  }, [emailsQuery.data]);

  const emailFolderTotal = useMemo(() => {
    const pages = emailsQuery.data?.pages;
    if (!pages?.length) return null;
    for (const p of pages) {
      const t = (p as { totalCount?: number }).totalCount;
      if (typeof t === "number" && t > 0) return t;
    }
    return null;
  }, [emailsQuery.data]);

  const isLoading = emailsQuery.isLoading;
  const hasNextPage = emailsQuery.hasNextPage;
  const isFetchingNextPage = emailsQuery.isFetchingNextPage;

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    const root = sentinel.closest("[data-radix-scroll-area-viewport]");
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (emailsQuery.hasNextPage && !emailsQuery.isFetchingNextPage) {
          void emailsQuery.fetchNextPage();
        }
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: "240px",
        threshold: 0.01,
      },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [
    allEmails.length,
    emailsQuery.fetchNextPage,
    emailsQuery.hasNextPage,
    emailsQuery.isFetchingNextPage,
    selectedFolderId,
    debouncedSearch,
  ]);

  const folderTreeData = useMemo(() => buildFolderTreeData(folders as any[]), [folders]);
  const { roots: folderRoots, childrenMap: folderChildrenMap, byId: folderById } = folderTreeData;
  const allMailFolderIds = useMemo(() => [...folderById.keys()], [folderById]);

  const folderVisibleIds = useMemo(
    () =>
      computeFolderSearchVisibility(
        folderRoots,
        folderChildrenMap,
        folderSidebarSearch,
        allMailFolderIds,
        folderById,
      ),
    [folderRoots, folderChildrenMap, folderSidebarSearch, allMailFolderIds, folderById],
  );

  const defaultFolderOrders = useMemo(
    () => defaultFolderOrdersFromTree(folderRoots, folderChildrenMap),
    [folderRoots, folderChildrenMap],
  );

  const mergedFolderOrderByParent = useMemo(() => {
    const out: Record<string, string[]> = {};
    const keys = new Set([...Object.keys(defaultFolderOrders), ...Object.keys(folderOrderByParent)]);
    for (const k of keys) {
      const def = defaultFolderOrders[k];
      if (!def?.length) continue;
      out[k] = mergeSiblingOrder(folderOrderByParent[k], def);
    }
    return out;
  }, [defaultFolderOrders, folderOrderByParent]);

  const orderedFolderRoots = useMemo(() => {
    const ids = mergedFolderOrderByParent[EMAIL_FOLDER_ORDER_ROOT_KEY] ?? folderRoots.map((r) => r.id);
    return ids.map((id) => folderById.get(id)).filter(Boolean) as any[];
  }, [mergedFolderOrderByParent, folderRoots, folderById]);

  const orderedFolderChildrenMap = useMemo(() => {
    const out = new Map<string, any[]>();
    for (const [pid, siblings] of folderChildrenMap) {
      const ids = mergedFolderOrderByParent[pid] ?? siblings.map((s) => s.id);
      out.set(
        pid,
        ids.map((id) => folderById.get(id)).filter(Boolean) as any[],
      );
    }
    return out;
  }, [mergedFolderOrderByParent, folderChildrenMap, folderById]);

  useEffect(() => {
    const m = mailFoldersData?.meta;
    if (!m) return;
    if (m.usedRootOnlyFallback) {
      if (typeof window !== "undefined") {
        try {
          if (sessionStorage.getItem(SESSION_LS_MAIL_FOLDERS_ROOT_FALLBACK_WARN) === "1") {
            return;
          }
          sessionStorage.setItem(SESSION_LS_MAIL_FOLDERS_ROOT_FALLBACK_WARN, "1");
        } catch {
          /* sin sessionStorage: mostrar toast igualmente */
        }
      }
      toast.warning(mailFoldersRootFallbackUserMessage(m.rootOnlyFallbackReason), {
        id: "mail-folders-root-fallback",
        duration: 11_000,
      });
      return;
    }
    if (m.truncated) {
      toast.warning(
        "La lista de carpetas puede estar incompleta por límites del servidor.",
        { id: "mail-folders-truncated", duration: 6_000 },
      );
    }
    // partialChildErrors is minor and non-actionable — suppress silently
  }, [
    mailFoldersData?.meta?.usedRootOnlyFallback,
    mailFoldersData?.meta?.rootOnlyFallbackReason,
    mailFoldersData?.meta?.truncated,
    mailFoldersData?.meta?.partialChildErrors,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !folderById.size) return;
    if (foldersCollapsed) return;
    try {
      if (localStorage.getItem(LS_EMAIL_FOLDERS_INBOX_AUTO_EXPAND_DONE) === "1") return;
    } catch {
      return;
    }
    const inbox = [...folderById.values()].find((f: any) => {
      const wk = String(f.wellKnownFolderName || "").toLowerCase();
      if (wk === "inbox") return true;
      const k = normFolderKey(String(f.displayName || ""));
      return k.includes("inbox") || k.includes("bandejadeentrada");
    });
    if (!inbox?.id) return;
    if ((folderChildrenMap.get(inbox.id) ?? []).length === 0) return;
    setExpandedFolderIds((prev) => {
      if (prev.has(inbox.id)) return prev;
      const next = new Set(prev);
      next.add(inbox.id);
      return next;
    });
    try {
      localStorage.setItem(LS_EMAIL_FOLDERS_INBOX_AUTO_EXPAND_DONE, "1");
    } catch {
      /* ignore */
    }
  }, [folderById, folderChildrenMap, foldersCollapsed]);

  const folderDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleEmailFolderDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !user?.id) return;
      const ap = active.data.current as { parentKey?: string } | undefined;
      const op = over.data.current as { parentKey?: string } | undefined;
      const parentKey = ap?.parentKey;
      if (!parentKey || parentKey !== op?.parentKey) return;
      const ids = mergedFolderOrderByParent[parentKey];
      if (!ids?.length) return;
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const next = arrayMove(ids, oldIndex, newIndex);
      const uid = user.id;
      setFolderOrderByParent((prev) => {
        const merged = { ...prev, [parentKey]: next };
        writeEmailFolderOrder(uid, merged);
        return merged;
      });
    },
    [mergedFolderOrderByParent, user?.id],
  );

  const sortedFolders = sortFolders(folders);

  const foldersForMoveList = useMemo(() => {
    const list = (folders as any[]).filter((f) => f?.id && f.id !== selectedFolderId);
    const { byId: bid } = folderTreeData;
    return [...list].sort((a, b) =>
      folderPathFromId(a.id, bid).localeCompare(folderPathFromId(b.id, bid), "es", { sensitivity: "base" }),
    );
  }, [folders, selectedFolderId, folderTreeData]);

  const foldersForMoveListFiltered = useMemo(() => {
    const q = moveFolderSearch.trim().toLowerCase();
    if (!q) return foldersForMoveList;
    return (foldersForMoveList as any[]).filter((f) => {
      const pathStr = folderPathFromId(f.id, folderById).toLowerCase();
      const dn = String(f.displayName || "").toLowerCase();
      const label = getFolderLabel(String(f.displayName || "")).toLowerCase();
      return pathStr.includes(q) || dn.includes(q) || label.includes(q);
    });
  }, [foldersForMoveList, moveFolderSearch, folderById]);

  const resolvedSelectedFolder = useMemo(() => {
    const list = folders as any[];
    const direct = list.find((f) => f.id === selectedFolderId);
    if (direct) return direct;
    if (selectedFolderId === "inbox") {
      return list.find((f) => {
        const sw = String(f.wellKnownFolderName || f.wellKnownName || "").toLowerCase();
        if (sw === "inbox") return true;
        const k = normFolderKey(String(f.displayName || ""));
        return k.includes("inbox") || k.includes("bandejadeentrada");
      });
    }
    return undefined;
  }, [folders, selectedFolderId]);

  useEffect(() => {
    const id = resolvedSelectedFolder?.id;
    if (!id || typeof id !== "string") return;
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      let cur: any = folderById.get(id);
      for (let i = 0; i < 48 && cur?.parentFolderId; i++) {
        const pid = cur.parentFolderId;
        if (typeof pid !== "string") break;
        next.add(pid);
        cur = folderById.get(pid);
      }
      return next;
    });
  }, [resolvedSelectedFolder?.id, folderById]);

  const handleMoveEmail = useCallback((messageId: string, destinationId: string) => {
    moveEmail.mutate({ messageId, destinationId }, {
      onSuccess: () => {
        if (selectedEmailId === messageId) {
          const idx = allEmails.findIndex((e: any) => e.id === messageId);
          const next = allEmails[idx + 1] || allEmails[idx - 1];
          setSelectedEmailId((next as { id?: string } | undefined)?.id || null);
          resetAction();
        }
        setMovePopoverOpen(false);
      },
    });
  }, [moveEmail, selectedEmailId, allEmails, resetAction]);

  const handleCreateFolderAndMove = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !selectedEmailId) return;
      createMailFolder.mutate(trimmed, {
        onSuccess: (data) => {
          setMovePopoverCreateOpen(false);
          setMoveFolderCreateName("");
          setMoveFolderSearch("");
          const id = typeof (data as { id?: unknown })?.id === "string" ? (data as { id: string }).id : undefined;
          if (id) handleMoveEmail(selectedEmailId, id);
        },
      });
    },
    [createMailFolder, selectedEmailId, handleMoveEmail],
  );

  const handleOpenEmail = useCallback((email: any) => {
    setSelectedEmailId(email.id);
    resetAction();
    setQuickAIPrompt(null);
    if (!email.isRead) markRead.mutate(email.id);
  }, [markRead, resetAction]);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__emailSearchTimeout);
    (window as any).__emailSearchTimeout = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const handleRefreshEmails = useCallback(async () => {
    const tasks: Array<Promise<unknown>> = [
      emailsQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["mail-folders"] }),
      queryClient.invalidateQueries({ queryKey: INBOX_UNREAD_QUERY_KEY }),
    ];

    if (selectedEmailId) {
      tasks.push(refetchEmailDetail());
    }

    const convId =
      emailDetail && typeof (emailDetail as { conversationId?: string }).conversationId === "string"
        ? (emailDetail as { conversationId: string }).conversationId.trim()
        : "";
    if (convId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ["email-conversation", convId] }));
    }

    await Promise.allSettled(tasks);
  }, [emailsQuery, queryClient, selectedEmailId, refetchEmailDetail, emailDetail]);

  const handleStartReply = async (action: EmailAction) => {
    if (!selectedEmailId || !action) return;
    setEmailAction(action);
    setRequestDeliveryReceipt(false);
    setRequestReadReceipt(false);
    setDraftId(null);
    setDraftHtml("");
    setReplyFiles([]);
    setReplyTo("");
    setReplyCc("");
    setReplyBcc("");
    setForwardTo("");
    setForwardCc("");
    setForwardBcc("");
    if (action === "forward") {
      try {
        const draft = await createForwardDraft.mutateAsync({ messageId: selectedEmailId });
        if (draft?.id) {
          setDraftId(draft.id);
          setDraftHtml(draft.body?.content || "");
          const fd = draft as {
            toRecipients?: unknown;
            ccRecipients?: unknown;
            bccRecipients?: unknown;
          };
          setForwardTo(graphRecipientsToInputString(fd.toRecipients));
          setForwardCc(graphRecipientsToInputString(fd.ccRecipients));
          setForwardBcc(graphRecipientsToInputString(fd.bccRecipients));
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo preparar el reenvío con firma");
        setEmailAction(null);
      }
      return;
    }
    try {
      const draft = await createReplyDraft.mutateAsync({
        messageId: selectedEmailId,
        replyAll: action === "reply-all",
      });
      if (draft && "unsupported" in draft && draft.unsupported) {
        toast.warning(String((draft as { message?: unknown }).message ?? "No soportado"));
        return;
      }
      const d = draft as {
        id?: string;
        body?: { content?: string };
        toRecipients?: unknown;
        ccRecipients?: unknown;
        bccRecipients?: unknown;
      };
      if (d?.id) {
        setDraftId(d.id);
        setDraftHtml(d.body?.content || "");
        let to = graphRecipientsToInputString(d.toRecipients);
        let cc = graphRecipientsToInputString(d.ccRecipients);
        let bcc = graphRecipientsToInputString(d.bccRecipients);
        if ((!to || (!cc && action === "reply-all")) && emailDetail) {
          const fb = fallbackReplyRecipientsFromDetail(
            emailDetail as Record<string, unknown>,
            action === "reply-all",
          );
          if (!to) to = fb.to;
          if (!cc) cc = fb.cc;
          if (!bcc) bcc = fb.bcc;
        }
        setReplyTo(to);
        setReplyCc(cc);
        setReplyBcc(bcc);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo preparar la respuesta");
    }
  };

  const handleScheduleMail = async (scheduledAtIso: string) => {
    if (!draftId || !user?.id) {
      toast.error("No hay borrador para programar.");
      return;
    }
    const when = new Date(scheduledAtIso);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now() + 30_000) {
      toast.error("Elige una fecha y hora al menos un minuto en el futuro.");
      return;
    }
    let scheduleTo: string[] = [];
    let scheduleCc: string[] = [];
    let scheduleBcc: string[] = [];
    if (emailAction === "forward") {
      scheduleTo = parseRecipients(forwardTo);
      scheduleCc = parseRecipients(forwardCc);
      scheduleBcc = parseRecipients(forwardBcc);
      const err = validateRecipientGroups({ to: scheduleTo, cc: scheduleCc, bcc: scheduleBcc });
      if (err) {
        toast.error(err);
        return;
      }
    } else if (emailAction === "reply" || emailAction === "reply-all") {
      scheduleTo = parseRecipients(replyTo);
      scheduleCc = parseRecipients(replyCc);
      scheduleBcc = parseRecipients(replyBcc);
      const err = validateRecipientGroups({ to: scheduleTo, cc: scheduleCc, bcc: scheduleBcc });
      if (err) {
        toast.error(err);
        return;
      }
    }
    let attachments: ComposerAttachment[] = [];
    if (replyFiles.length > 0) {
      try {
        attachments = await filesToComposerAttachments(replyFiles);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudieron adjuntar archivos");
        return;
      }
    }
    const attBytes = attachments.reduce((n, a) => n + (a.contentBytes?.length || 0), 0);
    if (attBytes > 3 * 1024 * 1024) {
      toast.warning("Adjuntos omitidos del envío programado (superan 3 MB en base64).");
      attachments = [];
    }
    setScheduleSubmitting(true);
    try {
      const graphTo = emailsToGraphRecipients(scheduleTo);
      const graphCc = emailsToGraphRecipients(scheduleCc);
      const graphBcc = emailsToGraphRecipients(scheduleBcc);

      const { error } = await supabase.from("scheduled_mail_jobs").insert({
        user_id: user.id,
        scheduled_at: when.toISOString(),
        draft_id: draftId,
        kind: "send_draft",
        payload: {
          body_html: draftHtml,
          is_delivery_receipt_requested: requestDeliveryReceipt,
          is_read_receipt_requested: requestReadReceipt,
          to_recipients: graphTo,
          cc_recipients: graphCc,
          bcc_recipients: graphBcc,
          ...(attachments.length ? { attachments } : {}),
        },
      });
      if (error) throw error;

      let movedToScheduledFolder = false;
      try {
        const folderId = await ensureScheduledMailFolderId();
        await moveDraftToScheduledFolder(draftId, folderId);
        movedToScheduledFolder = true;
        await queryClient.invalidateQueries({ queryKey: ["mail-folders"] });
        await queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      } catch (moveErr) {
        console.warn("[schedule mail] move to scheduled folder failed", moveErr);
      }

      if (movedToScheduledFolder) {
        toast.success(
          `Correo programado. Lo encontrarás en «${SCHEDULED_MAIL_FOLDER_DISPLAY_NAME}» hasta el envío.`,
        );
      } else {
        toast.success("Correo programado. Se enviará a la hora indicada.", {
          description: `No se pudo mover a «${SCHEDULED_MAIL_FOLDER_DISPLAY_NAME}»; el borrador sigue en Borradores.`,
        });
      }
      await queryClient.invalidateQueries({ queryKey: [...SCHEDULED_MAIL_JOBS_QUERY_KEY, user.id] });
      resetAction();
    } catch (e) {
      console.error("[schedule mail] insert failed", e);
      const raw = scheduleMailInsertErrorText(e);
      toast.error(raw ? humanizeScheduleMailError(raw) : "No se pudo programar el envío");
    } finally {
      setScheduleSubmitting(false);
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmailId) return;
    if (emailAction === "forward") {
      const forwardToList = parseRecipients(forwardTo);
      const forwardCcList = parseRecipients(forwardCc);
      const forwardBccList = parseRecipients(forwardBcc);
      const error = validateRecipientGroups({
        to: forwardToList,
        cc: forwardCcList,
        bcc: forwardBccList,
      });
      if (error) {
        toast.error(error);
        return;
      }
      let attachments: ComposerAttachment[] = [];
      if (replyFiles.length > 0) {
        try {
          attachments = await filesToComposerAttachments(replyFiles);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudieron adjuntar archivos");
          return;
        }
      }
      if (draftId) {
        sendDraft.mutate(
          {
            draftId,
            body: { contentType: "HTML", content: draftHtml },
            attachments,
            toRecipients: emailsToGraphRecipients(forwardToList),
            ccRecipients: emailsToGraphRecipients(forwardCcList),
            bccRecipients: emailsToGraphRecipients(forwardBccList),
            requestDeliveryReceipt,
            requestReadReceipt,
          },
          { onSuccess: resetAction }
        );
      } else {
        if (forwardCcList.length > 0 || forwardBccList.length > 0) {
          toast.error(
            "CC y CCO solo aplican con el borrador de Outlook. Cierra y vuelve a abrir el reenvío o comprueba la conexión con Microsoft.",
          );
          return;
        }
        forwardEmail.mutate(
          {
            messageId: selectedEmailId,
            comment: stripTags(draftHtml),
            toRecipients: forwardToList,
            attachments,
          },
          { onSuccess: resetAction }
        );
      }
      return;
    }
    if (draftId) {
      const replyToList = parseRecipients(replyTo);
      const replyCcList = parseRecipients(replyCc);
      const replyBccList = parseRecipients(replyBcc);
      const recErr = validateRecipientGroups({
        to: replyToList,
        cc: replyCcList,
        bcc: replyBccList,
      });
      if (recErr) {
        toast.error(recErr);
        return;
      }
      let attachments: ComposerAttachment[] = [];
      if (replyFiles.length > 0) {
        try {
          attachments = await filesToComposerAttachments(replyFiles);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudieron adjuntar archivos");
          return;
        }
      }
      sendDraft.mutate(
        {
          draftId,
          body: { contentType: "HTML", content: draftHtml },
          attachments,
          toRecipients: emailsToGraphRecipients(replyToList),
          ccRecipients: emailsToGraphRecipients(replyCcList),
          bccRecipients: emailsToGraphRecipients(replyBccList),
          requestDeliveryReceipt,
          requestReadReceipt,
        },
        { onSuccess: resetAction }
      );
    } else {
      replyEmail.mutate(
        { messageId: selectedEmailId, comment: stripTags(draftHtml), replyAll: emailAction === "reply-all" },
        { onSuccess: resetAction }
      );
    }
  };

  const handleArchive = useCallback((emailId: string) => {
    const idx = allEmails.findIndex((e: any) => e.id === emailId);
    const next = allEmails[idx + 1] || allEmails[idx - 1];
    if (selectedEmailId === emailId) {
      setSelectedEmailId((next as { id?: string } | undefined)?.id || null);
      resetAction();
    }
    archiveEmail.mutate(emailId);
  }, [archiveEmail, allEmails, selectedEmailId, resetAction]);

  const handleDelete = useCallback((emailId: string) => {
    const idx = allEmails.findIndex((e: any) => e.id === emailId);
    const next = allEmails[idx + 1] || allEmails[idx - 1];
    if (selectedEmailId === emailId) {
      setSelectedEmailId((next as { id?: string } | undefined)?.id || null);
      resetAction();
    }
    deleteEmail.mutate(emailId);
  }, [deleteEmail, allEmails, selectedEmailId, resetAction]);

  const toggleBulkSelect = useCallback((emailId: string, e: { stopPropagation(): void; shiftKey?: boolean }) => {
    e.stopPropagation();
    const idx = allEmails.findIndex((em: any) => em.id === emailId);
    if (e.shiftKey && lastBulkSelectedIdx >= 0 && idx >= 0) {
      const from = Math.min(lastBulkSelectedIdx, idx);
      const to = Math.max(lastBulkSelectedIdx, idx);
      setBulkSelectedIds(prev => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          next.add((allEmails[i] as any).id);
        }
        return next;
      });
    } else {
      setLastBulkSelectedIdx(idx);
      setBulkSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(emailId)) next.delete(emailId);
        else next.add(emailId);
        return next;
      });
    }
  }, [allEmails, lastBulkSelectedIdx]);

  const handleBulkArchive = useCallback(async () => {
    const ids = [...bulkSelectedIds];
    setBulkSelectedIds(new Set());
    for (const id of ids) {
      archiveEmail.mutate(id);
    }
    toast.success(`${ids.length} ${ids.length === 1 ? 'correo archivado' : 'correos archivados'}`);
  }, [archiveEmail, bulkSelectedIds]);

  const handleBulkMove = useCallback((destinationId: string) => {
    const ids = [...bulkSelectedIds];
    setBulkSelectedIds(new Set());
    setBulkMoveOpen(false);
    for (const id of ids) {
      moveEmail.mutate({ messageId: id, destinationId });
    }
    toast.success(`${ids.length} ${ids.length === 1 ? 'correo movido' : 'correos movidos'}`);
  }, [moveEmail, bulkSelectedIds]);

  const handleBulkMarkRead = useCallback(async () => {
    const ids = [...bulkSelectedIds];
    for (const id of ids) markRead.mutate(id);
    setBulkSelectedIds(new Set());
  }, [markRead, bulkSelectedIds]);

  const handleBulkDelete = useCallback(() => {
    const ids = [...bulkSelectedIds];
    setBulkSelectedIds(new Set());
    for (const id of ids) deleteEmail.mutate(id);
    toast.success(`${ids.length} ${ids.length === 1 ? "correo eliminado" : "correos eliminados"}`);
  }, [deleteEmail, bulkSelectedIds]);

  const closeDetailAiPanel = useCallback(() => {
    setDetailAiPanel(null);
    setDetailAiLoading(false);
    setDetailAiText("");
    setDetailAiTranslateTarget(null);
  }, []);

  const copyDetailAiText = useCallback(async () => {
    if (!detailAiText?.trim()) return;
    try {
      await navigator.clipboard.writeText(detailAiText);
      toast.success("Copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  }, [detailAiText]);

  useEffect(() => {
    closeDetailAiPanel();
  }, [selectedEmailId, closeDetailAiPanel]);

  const runDetailSummarize = useCallback(async () => {
    if (!emailDetail) return;
    setQuickAIPrompt(null);
    const plain = emailBodyToPlain(emailDetail.body?.content || "", emailDetail.body?.contentType);
    if (!plain) {
      toast.error("No hay contenido de correo para resumir");
      return;
    }
    setDetailAiPanel("summarize");
    setDetailAiLoading(true);
    setDetailAiText("");
    setDetailAiTranslateTarget(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-email-draft", {
        body: {
          action: "summarize",
          emailBody: plain,
          emailSubject: emailDetail.subject || "",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.message === "string" ? data.message : data.error);
      setDetailAiText((data?.text as string) || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al resumir");
      closeDetailAiPanel();
    } finally {
      setDetailAiLoading(false);
    }
  }, [emailDetail, closeDetailAiPanel]);

  const runDetailTranslate = useCallback(async () => {
    if (!emailDetail) return;
    setQuickAIPrompt(null);
    const plain = emailBodyToPlain(emailDetail.body?.content || "", emailDetail.body?.contentType);
    if (!plain) {
      toast.error("No hay contenido para traducir");
      return;
    }
    const targetLanguage = inferTranslationTarget(plain);
    setDetailAiTranslateTarget(targetLanguage);
    setDetailAiPanel("translate");
    setDetailAiLoading(true);
    setDetailAiText("");
    try {
      const { data, error } = await supabase.functions.invoke("ai-email-draft", {
        body: {
          action: "translate",
          emailBody: plain,
          targetLanguage,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.message === "string" ? data.message : data.error);
      setDetailAiText((data?.text as string) || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al traducir");
      closeDetailAiPanel();
    } finally {
      setDetailAiLoading(false);
    }
  }, [emailDetail, closeDetailAiPanel]);

  // Keyboard navigation (Superhuman style) + c = Redactar (checklist PDF)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) && emailAction) {
        e.preventDefault();
        void handleSendReply();
        return;
      }
      if (e.key === "Escape" && emailAction) {
        e.preventDefault();
        resetAction();
        return;
      }
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (
        e.key === "c" &&
        !emailAction &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        setComposeOpen(true);
        return;
      }

      if (!allEmails.length) return;

      const currentIdx = allEmails.findIndex((em: any) => em.id === selectedEmailId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, allEmails.length - 1);
        handleOpenEmail(allEmails[next]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        handleOpenEmail(allEmails[prev]);
      } else if (e.key === "r" && !emailAction) {
        e.preventDefault();
        handleStartReply("reply");
      } else if (e.key === "a" && !emailAction) {
        e.preventDefault();
        handleStartReply("reply-all");
      } else if (e.key === "f" && !emailAction) {
        e.preventDefault();
        handleStartReply("forward");
      } else if (e.key === "e" && selectedEmailId && !emailAction) {
        e.preventDefault();
        handleArchive(selectedEmailId);
      } else if (e.key === "u" && selectedEmailId && !emailAction) {
        e.preventDefault();
        markUnread.mutate(selectedEmailId);
      } else if (e.key === "#" && selectedEmailId && !emailAction) {
        e.preventDefault();
        handleDelete(selectedEmailId);
      } else if (e.key === "x" && selectedEmailId && !emailAction) {
        e.preventDefault();
        toggleBulkSelect(selectedEmailId, { stopPropagation: () => {} });
      } else if (e.key === "t" && selectedEmailId && !emailAction) {
        e.preventDefault();
        const em = allEmails.find((em: any) => em.id === selectedEmailId) as any;
        if (em) {
          setQuickTaskEmail({
            id: em.id,
            subject: em.subject,
            senderName: em.from?.emailAddress?.name,
            senderEmail: em.from?.emailAddress?.address,
            bodyPreview: em.bodyPreview,
            receivedDateTime: em.receivedDateTime,
          });
        } else {
          setCreateTaskOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    allEmails,
    selectedEmailId,
    handleOpenEmail,
    emailAction,
    handleArchive,
    handleDelete,
    draftHtml,
    draftId,
    forwardTo,
    replyFiles,
    handleSendReply,
    handleStartReply,
    markUnread,
    resetAction,
    toggleBulkSelect,
  ]);

  useEffect(() => {
    if (!movePopoverOpen || !emailDetail || folders.length === 0) {
      setAiSuggestedFolderId(null);
      return;
    }
    const subject = (emailDetail as any)?.subject || "";
    const bodyPlain = emailBodyToPlain((emailDetail as any)?.body?.content || "", (emailDetail as any)?.body?.contentType);
    if (!subject && !bodyPlain) return;

    setAiSuggestingFolder(true);
    const folderList = folders
      .filter((f: any) => f.displayName)
      .map((f: any) => `${f.id}|||${getFolderLabel(f.displayName as string)}`)
      .join("\n");

    supabase.functions.invoke("ai-email-draft", {
      body: {
        action: "suggest-folder",
        emailSubject: subject,
        emailBody: bodyPlain.slice(0, 800),
        folderList,
      },
    }).then(({ data, error }) => {
      if (error || !data?.folderId) return;
      setAiSuggestedFolderId(data.folderId as string);
    }).catch(() => {}).finally(() => {
      setAiSuggestingFolder(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movePopoverOpen]);

  const handleAfterSendTemplate = useCallback(async (info: { templateCategory?: string; clientId?: string; clientName?: string }) => {
    const declarationCategories = ["pagos_provisionales", "declaracion_ceros", "envio_anuales", "previos_provisionales", "isn_imss", "envio_nominas"];
    if (!info.templateCategory || !declarationCategories.includes(info.templateCategory)) return;
    if (!info.clientId) return;

    try {
      const { data: projects } = await supabase
        .from("projects")
        .select("id")
        .eq("client_id", info.clientId);

      if (!projects?.length) return;

      const now = new Date();
      for (const project of projects) {
        const { data: period } = await supabase
          .from("accounting_periods")
          .select("id, steps")
          .eq("project_id", project.id)
          .eq("year", now.getFullYear())
          .eq("month", now.getMonth() + 1)
          .maybeSingle();

        if (!period) continue;

        const steps = period.steps as Array<{ key: string; completed: boolean; label: string }>;
        const step = steps.find((s) => s.key === "envio_acuses");
        if (!step || step.completed) continue;

        toast.success(
          `Plantilla enviada a ${info.clientName || "cliente"}. ¿Marcar "${step.label}" como completado?`,
          {
            action: {
              label: "Marcar completo",
              onClick: async () => {
                const updatedSteps = steps.map((s) =>
                  s.key === "envio_acuses"
                    ? { ...s, completed: true, completed_at: new Date().toISOString(), completed_by: user?.id, step_status: "completado" }
                    : s,
                );
                const { error } = await supabase
                  .from("accounting_periods")
                  .update({ steps: updatedSteps as any })
                  .eq("id", period.id);
                if (!error) {
                  queryClient.invalidateQueries({ queryKey: ["accounting-periods", project.id] });
                  toast.success("Paso marcado como completado");
                }
              },
            },
            duration: 10000,
          },
        );
        break;
      }
    } catch {
      // silent fail - no interrumpir el flujo de correo
    }
  }, [user?.id, queryClient]);

  const isSending =
    replyEmail.isPending ||
    forwardEmail.isPending ||
    sendDraft.isPending ||
    createForwardDraft.isPending;
  const otherThreadEmails = useMemo(() => {
    const filtered = threadEmails.filter((e: any) => e.id !== selectedEmailId);
    return [...filtered].sort((a: any, b: any) => {
      const ta = Date.parse(emailListTimestamp(a)) || 0;
      const tb = Date.parse(emailListTimestamp(b)) || 0;
      return ta - tb;
    });
  }, [threadEmails, selectedEmailId]);

  /** Reposicionar historial arriba: al cambiar de mensaje, cerrar "expandir todo" para no heredar estado. */
  const [threadExpandAll, setThreadExpandAll] = useState(false);
  useEffect(() => {
    setThreadExpandAll(false);
  }, [selectedEmailId]);

  const threadHistoryLoading = Boolean(
    emailDetail && typeof (emailDetail as { conversationId?: string }).conversationId === "string" && (threadConvLoading || (threadConvFetching && threadEmails.length === 0)),
  );
  const hasPriorMessages = otherThreadEmails.length > 0;

  const threadContextForAi = useMemo(() => {
    if (!selectedEmailId) return "";
    return buildThreadContextForAi(
      emailDetail as Record<string, unknown> | undefined,
      threadEmails as Record<string, unknown>[],
      selectedEmailId,
    );
  }, [emailDetail, threadEmails, selectedEmailId]);

  const folderRow = (folder: any) => {
    const Icon = getFolderIcon(folder.displayName);
    const label = getFolderLabel(folder.displayName);
    const isActive = selectedFolderId === folder.id;
    const folderBadge = getFolderSidebarBadge(folder, inboxUnread);
    const dragHandlers = {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverFolderId(folder.id);
      },
      onDragLeave: () => setDragOverFolderId(null),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragOverFolderId(null);
        const messageId = e.dataTransfer.getData("text/email-id");
        if (messageId && folder.id !== selectedFolderId) handleMoveEmail(messageId, folder.id);
      },
    };
    const onSelect = () => {
      setSelectedFolderId(folder.id);
      setSelectedEmailId(null);
      resetAction();
      setBulkSelectedIds(new Set());
      if (isMobile) setShowFolders(false);
    };
    return { Icon, label, isActive, folderBadge, dragHandlers, onSelect };
  };

  function selectFolderAndClosePickers(folder: { id: string }) {
    setSelectedFolderId(folder.id);
    setSelectedEmailId(null);
    resetAction();
    setBulkSelectedIds(new Set());
    setFolderRailPickerOpen(false);
    setFolderRailPickerQuery("");
    if (isMobile) setShowFolders(false);
  }

  const sortableFolderSidebarTree = (
    <DndContext sensors={folderDndSensors} collisionDetection={closestCenter} onDragEnd={handleEmailFolderDragEnd}>
      <SortableContext
        items={orderedFolderRoots.filter((f) => folderVisibleIds.has(f.id)).map((f) => f.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="py-1 pr-2.5 pl-1">
          {orderedFolderRoots.map((folder: any) =>
            folderVisibleIds.has(folder.id) ? (
              <EmailFolderTreeItem
                key={folder.id}
                folder={folder}
                depth={0}
                parentListKey={EMAIL_FOLDER_ORDER_ROOT_KEY}
                orderedFolderChildrenMap={orderedFolderChildrenMap}
                folderVisibleIds={folderVisibleIds}
                expandedFolderIds={expandedFolderIds}
                setExpandedFolderIds={setExpandedFolderIds}
                dragOverFolderId={dragOverFolderId}
                folderRow={folderRow}
              />
            ) : null,
          )}
        </div>
      </SortableContext>
    </DndContext>
  );

  const folderRailPickerFlat = useMemo(() => {
    const q = folderRailPickerQuery.trim().toLowerCase();
    const list = sortedFolders as any[];
    if (!q) return list;
    return list.filter((f) => {
      const pathStr = folderPathFromId(f.id, folderById).toLowerCase();
      return pathStr.includes(q) || String(f.displayName || "").toLowerCase().includes(q);
    });
  }, [sortedFolders, folderRailPickerQuery, folderById]);

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
        <div
          className="hidden shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 md:flex"
          data-kawiil-email-toolbar="1"
        >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paneles</span>
            <ToggleGroup
              type="multiple"
              size="sm"
              value={[
                ...(foldersCollapsed ? [] : ["folders"]),
                ...(listPaneCollapsed ? [] : ["list"]),
              ]}
              onValueChange={(values: string[]) => {
                setFoldersCollapsed(!values.includes("folders"));
                if (selectedEmailId) {
                  setListPaneCollapsed(!values.includes("list"));
                }
              }}
              className="rounded-lg border border-border/60 bg-background"
            >
              <ToggleGroupItem value="folders" aria-label="Mostrar carpetas">
                {foldersCollapsed ? (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5 hidden md:inline text-[11px]">Carpetas</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="list"
                aria-label="Mostrar lista"
                disabled={!selectedEmailId}
                title={!selectedEmailId ? "Abre un correo para usar esta opción" : undefined}
              >
                {listPaneCollapsed ? (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightClose className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5 hidden md:inline text-[11px]">Lista</span>
              </ToggleGroupItem>
            </ToggleGroup>
            {import.meta.env.DEV && (
              <span
                className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums"
                title="Si no cambia tras deploy, Lovable aún muestra un bundle antiguo."
              >
                {EMAIL_VIEW_LAYOUT_VERSION}
              </span>
            )}
        </div>
        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-row overflow-hidden bg-background">
      {/* Folder sidebar — móvil: overlay; escritorio: expandible o riel de iconos */}
      <div
        className={cn(
          "relative z-[1] flex min-h-0 flex-col border-r border-border bg-muted/30 transition-[width] duration-200 ease-out",
          isMobile
            ? cn(showFolders ? "absolute z-30 h-full w-[17rem] shadow-xl" : "w-0 shrink-0 overflow-hidden border-0")
            : cn(
                "shrink-0 overflow-hidden",
                foldersCollapsed ? "w-[3.25rem]" : "w-[15rem]",
              ),
        )}
      >
        {isMobile ? (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Carpetas</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowFolders(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={folderSidebarSearch}
                  onChange={(e) => setFolderSidebarSearch(e.target.value)}
                  placeholder="Buscar carpeta…"
                  className="h-8 border-0 bg-muted/50 pl-8 text-xs"
                  aria-label="Buscar carpeta"
                />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">{sortableFolderSidebarTree}</ScrollArea>
            <div className="shrink-0 border-t border-border p-2">
              {creatingFolder ? (
                <div className="flex items-center gap-1">
                  <Input
                    autoFocus placeholder="Nombre..." className="h-7 text-xs flex-1"
                    value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newFolderName.trim()) {
                        createMailFolder.mutate(newFolderName.trim(), { onSuccess: () => { setCreatingFolder(false); setNewFolderName(""); } });
                      }
                      if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                    onClick={() => { if (newFolderName.trim()) createMailFolder.mutate(newFolderName.trim(), { onSuccess: () => { setCreatingFolder(false); setNewFolderName(""); } }); }}
                    disabled={createMailFolder.isPending}
                  >
                    {createMailFolder.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="w-full h-7 text-xs justify-start gap-2" onClick={() => setCreatingFolder(true)}>
                  <FolderPlus className="h-3.5 w-3.5" /> Nueva carpeta
                </Button>
              )}
            </div>
          </>
        ) : (
          <TooltipProvider delayDuration={250}>
            {foldersCollapsed ? (
              <>
                <div className="flex justify-center border-b border-border/50 py-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        aria-label="Mostrar nombres de carpetas"
                        onClick={() => setFoldersCollapsed(false)}
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Expandir carpetas</TooltipContent>
                  </Tooltip>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col items-center gap-0.5 py-1 px-1">
                    {orderedFolderRoots.map((folder: any) => {
                      const { Icon, label, folderBadge, dragHandlers, onSelect } = folderRow(folder);
                      const railActive = folderRailRootIsActive(folder.id, selectedFolderId, folderById);
                      const tip = folderPathFromId(folder.id, folderById);
                      return (
                        <Tooltip key={folder.id}>
                          <TooltipTrigger asChild>
                            <div className="relative">
                            <button
                              type="button"
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent/60",
                                railActive && "bg-accent text-accent-foreground ring-1 ring-primary",
                                dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary",
                              )}
                              onClick={onSelect}
                              {...dragHandlers}
                            >
                              <Icon className="h-4 w-4 text-muted-foreground" />
                            </button>
                              {folderBadge != null && folderBadge > 0 && (
                                <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold tabular-nums text-primary-foreground z-10">
                                  {folderBadge > 99 ? "99+" : folderBadge > 9 ? "9+" : folderBadge}
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[14rem]">
                            <span className="block font-medium">{label}</span>
                            <span className="block text-[11px] text-muted-foreground">{tip}</span>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </ScrollArea>
                <div className="flex shrink-0 flex-col items-center gap-0.5 border-t border-border py-1">
                  <Popover
                    open={folderRailPickerOpen}
                    onOpenChange={(o) => {
                      setFolderRailPickerOpen(o);
                      if (!o) setFolderRailPickerQuery("");
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Más carpetas">
                            <List className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right">Más carpetas</TooltipContent>
                    </Tooltip>
                    <PopoverContent side="right" align="end" className="w-72 p-2">
                      <div className="relative mb-2">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={folderRailPickerQuery}
                          onChange={(e) => setFolderRailPickerQuery(e.target.value)}
                          placeholder="Buscar carpeta…"
                          className="h-8 border-0 bg-muted/50 pl-8 text-xs"
                          autoFocus
                        />
                      </div>
                      <ScrollArea className="max-h-72">
                        <div className="flex flex-col gap-0.5 pr-2">
                          {folderRailPickerFlat.length === 0 ? (
                            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Sin coincidencias</p>
                          ) : (
                            folderRailPickerFlat.map((folder: any) => {
                              const Icon = getFolderIcon(folder.displayName);
                              const pathStr = folderPathFromId(folder.id, folderById);
                              return (
                                <button
                                  key={folder.id}
                                  type="button"
                                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                                  onClick={() => selectFolderAndClosePickers(folder)}
                                >
                                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate">{getFolderLabel(folder.displayName)}</span>
                                    <span className="block truncate text-[11px] text-muted-foreground">{pathStr}</span>
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        aria-label="Nueva carpeta"
                        onClick={() => {
                          setFoldersCollapsed(false);
                          setCreatingFolder(true);
                        }}
                      >
                        <FolderPlus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Nueva carpeta</TooltipContent>
                  </Tooltip>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-1 border-b border-border/50 px-2 py-2">
                  <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">Carpetas</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Contraer panel de carpetas"
                        onClick={() => setFoldersCollapsed(true)}
                      >
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Solo iconos</TooltipContent>
                  </Tooltip>
                </div>
                <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={folderSidebarSearch}
                      onChange={(e) => setFolderSidebarSearch(e.target.value)}
                      placeholder="Buscar carpeta…"
                      className="h-8 border-0 bg-muted/50 pl-8 text-xs"
                      aria-label="Buscar carpeta"
                    />
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  {sortableFolderSidebarTree}
                  {/* Etiquetas AI (categorías Outlook) */}
                  {(outlookCategories as any[]).length > 0 && (
                    <div className="mt-2 border-t border-border/50 pt-2">
                      <div className="mb-1 flex items-center gap-1.5 px-2.5">
                        <Sparkles className="h-3 w-3 text-sky-500" aria-hidden />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Etiquetas AI
                        </span>
                      </div>
                      <div className="space-y-0.5 px-1">
                        {(outlookCategories as any[]).slice(0, 8).map((cat: any) => {
                          const name = cat?.displayName as string | undefined;
                          if (!name) return null;
                          const color = categoryColorMap.get(name) || "hsl(var(--primary))";
                          return (
                            <button
                              key={cat.id || name}
                              type="button"
                              title={name}
                              className="group flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-1 text-left text-xs transition-colors hover:bg-accent/50"
                              onClick={() => {
                                handleSearch(`category:"${name}"`);
                              }}
                            >
                              <span
                                className="inline-block h-2 w-2 shrink-0 rounded-full"
                                style={{ background: color }}
                              />
                              <span className="min-w-0 flex-1 truncate text-foreground/85 group-hover:text-foreground">
                                {name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Indicador de sincronización Outlook */}
                  <div className="mx-2 mb-2 mt-3 rounded-lg border border-border/60 bg-muted/30 p-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold uppercase tracking-wider text-muted-foreground">Outlook</span>
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Sincronizado
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "62%",
                          background: "linear-gradient(90deg, hsl(207 100% 42%), hsl(217 91% 60%))",
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[9px] text-muted-foreground/70 tabular-nums">
                      Última lectura · ahora
                    </p>
                  </div>
                </ScrollArea>
                <div className="shrink-0 border-t border-border p-2">
                  {creatingFolder ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus placeholder="Nombre..." className="h-7 flex-1 text-xs"
                        value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newFolderName.trim()) {
                            createMailFolder.mutate(newFolderName.trim(), { onSuccess: () => { setCreatingFolder(false); setNewFolderName(""); } });
                          }
                          if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={() => { if (newFolderName.trim()) createMailFolder.mutate(newFolderName.trim(), { onSuccess: () => { setCreatingFolder(false); setNewFolderName(""); } }); }}
                        disabled={createMailFolder.isPending}
                      >
                        {createMailFolder.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 w-full justify-start gap-2 text-xs" onClick={() => setCreatingFolder(true)}>
                      <FolderPlus className="h-3.5 w-3.5" /> Nueva carpeta
                    </Button>
                  )}
                </div>
              </>
            )}
          </TooltipProvider>
        )}
      </div>

      {/* Email list panel — estrecho cuando hay email abierto (Superhuman) */}
      <div
        className={cn(
          "relative z-[2] flex min-h-0 flex-col overflow-hidden border-r border-border bg-background transition-all duration-200 ease-out",
          isMobile
            ? "min-w-0 flex-1"
            : selectedEmailId
              ? "pointer-events-none w-0 min-w-0 shrink-0 overflow-hidden border-0 p-0 opacity-0"
              : "min-w-[22rem] flex-[0_1_min(44rem,52vw)]",
          selectedEmailId && isMobile && "hidden",
        )}
      >
        {/* Search & compose toolbar */}
        {/* Superhuman-style toolbar: compact single row */}
        <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
          <TooltipProvider delayDuration={250}>
            <div className="flex items-center gap-1">
              {isMobile && (
                <button type="button" className="p-1.5 rounded hover:bg-muted text-muted-foreground" onClick={() => setShowFolders(true)}>
                  <FolderOpen className="h-4 w-4" />
                </button>
              )}
              {/* Search — expands to fill, minimal style */}
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  placeholder="Buscar…"
                  className="h-7 border-0 bg-transparent pl-7 text-[13px] focus-visible:ring-0 focus-visible:bg-muted/30 placeholder:text-muted-foreground/40"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                onClick={() => void handleRefreshEmails()}
                disabled={emailsQuery.isRefetching}
                title="Actualizar"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", emailsQuery.isRefetching && "animate-spin")} />
              </button>
              <button
                type="button"
                className={cn("p-1.5 rounded text-muted-foreground", aiInboxOpen ? "bg-primary/10 text-primary" : "hover:bg-muted")}
                onClick={() => setAiInboxOpen((v) => !v)}
                title={aiInboxOpen ? "Cerrar triaje IA" : "Triaje IA"}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:opacity-90"
                onClick={() => setComposeOpen(true)}
              >
                <Send className="h-3 w-3" />
                <span className={cn(selectedEmailId && !isMobile ? "hidden" : "hidden sm:inline")}>Redactar</span>
              </button>
            </div>
          </TooltipProvider>
          {/* Filter tabs / bulk actions — same row, no layout shift */}
          {bulkSelectedIds.size > 0 ? (
            <div className="flex items-center gap-1 mt-1 -mx-1 min-w-0">
              <span className="text-[11px] font-semibold text-primary tabular-nums px-1.5 shrink-0">
                {bulkSelectedIds.size} sel.
              </span>
              <div className="h-3.5 w-px bg-border/60 shrink-0" />
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1 text-[11px] shrink-0"
                      onClick={() => void handleBulkArchive()} disabled={archiveEmail.isPending}>
                      <Archive className="h-3 w-3" />Archivar
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">Archivar seleccionados</TooltipContent>
                </Tooltip>
                <Popover open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1 text-[11px] shrink-0">
                      <FolderInput className="h-3 w-3" />Mover
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="bottom" sideOffset={4} className="w-64 p-2 space-y-1">
                    <p className="px-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Mover {bulkSelectedIds.size} correo{bulkSelectedIds.size > 1 ? "s" : ""} a
                    </p>
                    <Input
                      value={bulkMoveFolderSearch}
                      onChange={(e) => setBulkMoveFolderSearch(e.target.value)}
                      placeholder="Buscar carpeta…"
                      className="h-8 text-xs mb-1"
                      autoFocus
                    />
                    <div className="max-h-52 overflow-y-auto space-y-0.5">
                      {folders
                        .filter((f: any) => {
                          if (!bulkMoveFolderSearch.trim()) return true;
                          return getFolderLabel(String(f.displayName || "")).toLowerCase().includes(bulkMoveFolderSearch.toLowerCase());
                        })
                        .map((f: any) => {
                          const FIcon = getFolderIcon(String(f.displayName || ""));
                          return (
                            <button key={f.id} type="button"
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => handleBulkMove(f.id)}>
                              <FIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 truncate">{getFolderLabel(String(f.displayName || ""))}</span>
                            </button>
                          );
                        })}
                    </div>
                  </PopoverContent>
                </Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1 text-[11px] shrink-0"
                      onClick={() => void handleBulkMarkRead()}>
                      <MailOpen className="h-3 w-3" />Leídos
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">Marcar como leídos</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm"
                      className="h-6 px-1.5 gap-1 text-[11px] shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleBulkDelete()}>
                      <Trash2 className="h-3 w-3" />Eliminar
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">Eliminar seleccionados</TooltipContent>
                </Tooltip>
                <button type="button" onClick={() => setBulkSelectedIds(new Set())}
                  className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0">
                  <X className="h-3 w-3" />
                </button>
              </TooltipProvider>
            </div>
          ) : (
            <div className="flex items-center gap-0 mt-1 -mx-1">
              {([
                { id: "all", label: "Todo" },
                { id: "unread", label: "No leídos" },
                { id: "attachments", label: "Adjuntos" },
                { id: "sat", label: "SAT" },
                { id: "facturas", label: "Facturas" },
              ] as const).map((f) => {
                const active = listFilter === f.id;
                return (
                  <button key={f.id} type="button" onClick={() => setListFilter(f.id)}
                    className={cn(
                      "px-2 py-0.5 text-[11px] rounded transition-colors",
                      active ? "font-semibold text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
                    )}>
                    {f.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Lista con scroll + pie fijo para «más correos» (siempre visible) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="min-h-0 min-w-0 flex-1 px-0" ref={listRef}>
          {isLoading ? (
            <div className="py-2 space-y-0">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-2.5 px-4 py-2.5 border-b border-border/40 animate-pulse">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-2 h-2 rounded-full bg-transparent shrink-0" />
                    <div className="h-8 w-8 rounded-full bg-secondary/40 shrink-0" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2 pt-0.5">
                    <div className="h-3.5 bg-secondary/40 rounded w-2/3" />
                    <div className="h-3 bg-secondary/30 rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : allEmails.length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-muted/50 mb-3">
                <Mail className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Sin correos</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {debouncedSearch.trim()
                  ? `Ningún resultado para “${debouncedSearch.trim()}”. Prueba otras palabras o revisa deletreo.`
                  : "Esta carpeta está vacía"}
              </p>
            </div>
          ) : (
            <div className="px-0">
              {(() => {
                let visible = allEmails;
                if (listFilter !== "all") {
                  visible = visible.filter((e: any) => {
                    if (listFilter === "unread") return !e.isRead;
                    if (listFilter === "attachments") return Boolean(e.hasAttachments);
                    if (listFilter === "sat") {
                      const dom = ((e.from?.emailAddress?.address || "").toLowerCase().split("@")[1] || "");
                      return /sat\.gob/.test(dom) || /\bSAT\b/.test(e.subject || "");
                    }
                    if (listFilter === "facturas") return /factura|invoice|recibo cfe|telmex|microsoft 365 business/i.test(e.subject || "");
                    return true;
                  });
                }
                if (visible.length === 0) {
                  return (
                    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                      Sin resultados para este filtro.
                    </div>
                  );
                }
                let lastBucket: DateBucket | null = null;
                return visible.map((email: any) => {
                const ts = emailListTimestamp(email);
                const bucket = getDateBucket(ts, now);
                const showSep = bucket !== lastBucket;
                if (showSep) lastBucket = bucket;
                const isActive = selectedEmailId === email.id;
                const unread = !email.isRead;
                const senderName = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Desconocido";
                const senderEmail = email.from?.emailAddress?.address || "";
                const subject = email.subject || "(sin asunto)";
                const bodyPreview = (email.bodyPreview || "").trim() || "…";
                return (
                  <div key={email.id} className="contents">
                  {showSep && (
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-border/40 bg-background/85 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-md">
                      <span>{getBucketLabel(bucket, ts ? new Date(ts) : null)}</span>
                      <span className="ml-auto rounded-full bg-muted/70 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/80">
                        {visible.filter((x: any) => getDateBucket(emailListTimestamp(x), now) === bucket).length}
                      </span>
                    </div>
                  )}
                  <div
                    draggable
                    onMouseEnter={() => prefetchEmailDetail(email.id)}
                    onDragStart={(e) => { e.dataTransfer.setData("text/email-id", email.id); e.dataTransfer.effectAllowed = "move"; }}
                    className={cn(
                      "group relative flex min-w-0 w-full cursor-pointer select-none transition-colors border-b border-border/20 px-3 py-1.5",
                      isActive && !bulkSelectedIds.has(email.id) && "bg-accent/60 border-l-2 border-l-foreground/30 pl-[10px]",
                      unread && !isActive && !bulkSelectedIds.has(email.id) && "bg-blue-50/30 dark:bg-blue-950/10",
                      !isActive && !bulkSelectedIds.has(email.id) && "hover:bg-muted/40",
                      bulkSelectedIds.has(email.id) && "bg-primary/5 border-l-2 border-l-primary pl-[10px]",
                    )}
                    onClick={(ev) => bulkSelectedIds.size > 0 ? toggleBulkSelect(email.id, ev) : handleOpenEmail(email)}
                  >
                    {/* Left: checkbox + unread dot */}
                    <div
                      className="relative mr-2 flex h-4 w-4 shrink-0 items-center justify-center self-center"
                      onClick={(e) => toggleBulkSelect(email.id, e)}
                    >
                      <div
                        className={cn(
                          "absolute inset-0 flex items-center justify-center rounded border transition-all",
                          bulkSelectedIds.has(email.id)
                            ? "border-primary bg-primary opacity-100"
                            : "border-border/60 bg-background opacity-0 group-hover:opacity-100",
                          bulkSelectedIds.size > 0 && "opacity-100",
                        )}
                      >
                        {bulkSelectedIds.has(email.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      <div
                        className={cn(
                          "h-1.5 w-1.5 rounded-full transition-opacity",
                          unread ? "bg-blue-500" : "bg-transparent",
                          "group-hover:opacity-0",
                          (bulkSelectedIds.size > 0 || bulkSelectedIds.has(email.id)) && "opacity-0",
                        )}
                        aria-hidden
                      />
                    </div>

                    {/* Main content — one line layout */}
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      {/* Sender — fixed width */}
                      <span
                        className={cn(
                          "w-32 shrink-0 truncate text-[13px] leading-5",
                          unread ? "font-semibold text-foreground" : "text-foreground/75",
                        )}
                        title={senderName}
                      >
                        {senderName}
                      </span>

                      {/* Subject + preview — flex-1 */}
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                        {email.importance === "high" && (
                          <span className="mr-1 inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-destructive align-middle" aria-hidden />
                        )}
                        {email.hasAttachments && (
                          <Paperclip className="mr-1 inline-block h-3 w-3 shrink-0 translate-y-[-1px] text-muted-foreground/60 align-middle" aria-hidden />
                        )}
                        <span className={cn(unread ? "font-medium text-foreground" : "text-foreground/80")}>
                          {subject}
                        </span>
                        {bodyPreview && bodyPreview !== "…" && (
                          <span className="text-muted-foreground/60"> — {bodyPreview}</span>
                        )}
                      </span>

                      {/* Chips (only when not collapsed) */}
                      {(() => {
                        const inferred = inferEmailChips(email);
                        if (inferred.length === 0) return null;
                        return (
                          <span className="hidden sm:flex shrink-0 items-center gap-1">
                            {inferred.slice(0, 2).map((chip) => (
                              <span
                                key={`inf-${chip.tone}`}
                                className={cn(
                                  "inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
                                  INFERRED_CHIP_STYLES[chip.tone],
                                )}
                              >
                                {chip.label}
                              </span>
                            ))}
                          </span>
                        );
                      })()}

                      {/* Hover actions */}
                      <div
                        className={cn(
                          "shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity max-sm:hidden",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setQuickTaskEmail({
                                  id: email.id,
                                  subject: email.subject,
                                  senderName: email.from?.emailAddress?.name,
                                  senderEmail: email.from?.emailAddress?.address,
                                  bodyPreview: email.bodyPreview,
                                  receivedDateTime: email.receivedDateTime,
                                });
                              }}
                            >
                              <ListTodo className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Crear tarea (t)</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              onClick={() => handleArchive(email.id)}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Archivar (e)</TooltipContent>
                        </Tooltip>
                        {email.isRead ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                onClick={() => markUnread.mutate(email.id)}
                              >
                                <Mail className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">No leído (u)</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                onClick={() => markRead.mutate(email.id)}
                              >
                                <MailOpen className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Leído</TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      {/* Timestamp */}
                      <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums whitespace-nowrap group-hover:hidden">
                        {formatEmailDate(emailListTimestamp(email))}
                      </span>
                    </div>
                  </div>
                  </div>
                );
                });
              })()}

              {/* Sentinel dentro del scroll para cargar al acercarse al final */}
              {hasNextPage && (
                <div ref={loadMoreSentinelRef} className="h-4 w-full shrink-0" aria-hidden />
              )}
            </div>
          )}
        </ScrollArea>

        {!isLoading && allEmails.length > 0 && (hasNextPage || isFetchingNextPage) && (
          <div className="shrink-0 border-t border-border/60 bg-muted/30 px-3 py-2">
            {emailFolderTotal != null && (
              <p className="mb-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
                Mostrando {allEmails.length} de {emailFolderTotal}
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="h-9 w-full gap-2"
              onClick={() => emailsQuery.fetchNextPage()}
              disabled={isFetchingNextPage || !hasNextPage}
            >
              {isFetchingNextPage ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" />
              )}
              {isFetchingNextPage ? "Cargando..." : "Cargar correos anteriores"}
            </Button>
          </div>
        )}
        </div>
      </div>

      {/* Detail panel — oculto hasta que el usuario seleccione un correo */}
      <div
        style={!selectedEmailId ? { display: "none" } : undefined}
        className="relative z-[3] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background border-l border-border/40"
      >
        {!selectedEmailId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 select-none">
            <div className="flex flex-col items-center gap-3 text-center">
              <Mail className="h-10 w-10 text-muted-foreground/20" strokeWidth={1} />
              <p className="text-sm text-muted-foreground/40 font-medium tracking-wide">Ningún correo seleccionado</p>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              {[
                [["j", "k"], "navegar"],
                [["c"], "redactar"],
                [["r"], "responder"],
                [["e"], "archivar"],
                [["x"], "seleccionar"],
                [["t"], "crear tarea"],
              ].map(([keys, label]) => (
                <div key={String(label)} className="flex items-center gap-2 text-[11px] text-muted-foreground/35">
                  <span className="flex items-center gap-0.5">
                    {(keys as string[]).map(k => (
                      <kbd key={k} className="px-1 py-px bg-muted/50 rounded text-[10px] font-mono">{k}</kbd>
                    ))}
                  </span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detailQueryFailed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden />
            </div>
            <div className="max-w-md space-y-2">
              <p className="text-sm font-medium text-foreground">No se pudo cargar este correo</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {detailQueryError instanceof Error && detailQueryError.message
                  ? detailQueryError.message
                  : "El mensaje pudo haberse eliminado o moverse en Outlook. Actualiza la lista e inténtalo de nuevo."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setSelectedEmailId(null);
                  void queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
                }}
              >
                Volver a la lista
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => void refetchEmailDetail()}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : emailDetail ? (
          <div
            className="flex-1 flex flex-col overflow-hidden bg-background"
            data-email-layout={EMAIL_VIEW_LAYOUT_VERSION}
          >
            {/* Detail header */}
            <div className="px-3 sm:px-4 py-2 border-b border-border/50 shrink-0 bg-background/80 backdrop-blur-sm shadow-sm">
              {/* Back to list — always visible */}
              <div className="mb-1.5 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-1.5 h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedEmailId(null)}
                >
                  <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                  Lista
                </Button>
              </div>
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2
                  className="text-base font-semibold text-foreground leading-tight line-clamp-2 break-words flex-1 min-w-0"
                  title={emailDetail.subject || "(sin asunto)"}
                >
                  {emailDetail.subject || "(sin asunto)"}
                </h2>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                  {emailDetail.receivedDateTime
                    ? format(parseISO(emailDetail.receivedDateTime), "d MMM yyyy, HH:mm", { locale: es })
                    : ""}
                </span>
              </div>

              {/* Sender + recipients block */}
              {(() => {
                const toList = (emailDetail.toRecipients || []) as any[];
                const ccList = (emailDetail.ccRecipients || []) as any[];
                const bccList = (emailDetail.bccRecipients || []) as any[];
                const hasExtra = ccList.length > 0 || bccList.length > 0;
                return (
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 mt-0.5",
                      getAvatarColor(emailDetail.from?.emailAddress?.address)
                    )}>
                      {getInitials(emailDetail.from?.emailAddress?.name, emailDetail.from?.emailAddress?.address)}
                    </div>
                    <div className="min-w-0 flex-1 text-xs">
                      {/* De */}
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-muted-foreground/60 shrink-0 w-6">De</span>
                        <span className="font-medium text-foreground">
                          {emailDetail.from?.emailAddress?.name || emailDetail.from?.emailAddress?.address}
                        </span>
                        {emailDetail.from?.emailAddress?.name && (
                          <span className="text-muted-foreground/70 truncate">
                            &lt;{emailDetail.from?.emailAddress?.address}&gt;
                          </span>
                        )}
                      </div>
                      {/* Para */}
                      {toList.length > 0 && (
                        <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-muted-foreground/60 shrink-0 w-6">Para</span>
                          <span className="text-foreground/80 min-w-0">
                            {toList.map((r: any) => recipientToFieldDisplay(r)).filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                      {/* CC */}
                      {ccList.length > 0 && (
                        <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-muted-foreground/60 shrink-0 w-6">CC</span>
                          <span className="text-foreground/80 min-w-0">
                            {ccList.map((r: any) => recipientToFieldDisplay(r)).filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                      {/* BCC */}
                      {bccList.length > 0 && (
                        <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-muted-foreground/60 shrink-0 w-6">CCO</span>
                          <span className="text-foreground/80 min-w-0">
                            {bccList.map((r: any) => recipientToFieldDisplay(r)).filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {import.meta.env.DEV && (
                <Badge variant="outline" className="mt-1 text-[10px] font-semibold px-2 py-0.5 border-primary/40 bg-primary/10 text-primary tracking-tight">
                  {EMAIL_VIEW_LAYOUT_VERSION}
                </Badge>
              )}
            </div>

            {/* Action bar: una sola fila, scroll horizontal si no cabe */}
            <TooltipProvider delayDuration={200}>
              <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50 shrink-0 bg-muted/20 overflow-x-auto scrollbar-none min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={emailAction === "reply" ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => (emailAction === "reply" ? resetAction() : handleStartReply("reply"))}
                    >
                      <Reply className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      Responder
                      <kbd className="px-1 py-[1px] bg-muted/40 text-muted-foreground rounded text-[10px] font-mono">r</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={emailAction === "reply-all" ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        emailAction === "reply-all" ? resetAction() : handleStartReply("reply-all")
                      }
                    >
                      <ReplyAll className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      Todos
                      <kbd className="px-1 py-[1px] bg-muted/40 text-muted-foreground rounded text-[10px] font-mono">a</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={emailAction === "forward" ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        emailAction === "forward" ? resetAction() : handleStartReply("forward")
                      }
                    >
                      <Forward className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      Reenviar
                      <kbd className="px-1 py-[1px] bg-muted/40 text-muted-foreground rounded text-[10px] font-mono">f</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-5 bg-border shrink-0 mx-0.5" aria-hidden />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => selectedEmailId && handleArchive(selectedEmailId)}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      Archivar
                      <kbd className="px-1 py-[1px] bg-muted/40 text-muted-foreground rounded text-[10px] font-mono">e</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>

                <Popover
                  open={movePopoverOpen}
                  onOpenChange={(o) => {
                    setMovePopoverOpen(o);
                    if (!o) {
                      setMoveFolderSearch("");
                      setMovePopoverCreateOpen(false);
                      setMoveFolderCreateName("");
                    }
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <FolderInput className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Mover
                    </TooltipContent>
                  </Tooltip>
                  <PopoverContent className="flex w-72 flex-col p-0" align="start">
                    <div className="shrink-0 border-b border-border/50 p-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={moveFolderSearch}
                          onChange={(e) => setMoveFolderSearch(e.target.value)}
                          placeholder="Buscar carpeta…"
                          className="h-8 border-0 bg-muted/50 pl-8 text-xs"
                          autoFocus
                          aria-label="Buscar carpeta para mover"
                        />
                      </div>
                    </div>
                    <ScrollArea className="max-h-72">
                      <div className="flex flex-col gap-0.5 p-2 pr-2">
                        {/* Sugerencia de IA */}
                        {(aiSuggestingFolder || aiSuggestedFolderId) && (
                          <div className="mb-1 pb-1.5 border-b border-border/40">
                            <p className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                              <Sparkles className="h-3 w-3 text-blue-500" />
                              Sugerida por IA
                            </p>
                            {aiSuggestingFolder ? (
                              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Analizando correo…
                              </div>
                            ) : aiSuggestedFolderId && folderById.get(aiSuggestedFolderId) ? (
                              <button
                                type="button"
                                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors bg-blue-50/60 ring-1 ring-blue-200/60 hover:bg-blue-100/60 dark:bg-blue-950/20 dark:ring-blue-900/40 dark:hover:bg-blue-950/40"
                                onClick={() => {
                                  if (selectedEmailId) handleMoveEmail(selectedEmailId, aiSuggestedFolderId);
                                }}
                              >
                                {(() => {
                                  const sf = folderById.get(aiSuggestedFolderId)!;
                                  const SIcon = getFolderIcon(String(sf.displayName || ""));
                                  return (
                                    <>
                                      <SIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                                      <span className="min-w-0 flex-1 truncate font-medium text-blue-800 dark:text-blue-200">
                                        {getFolderLabel(String(sf.displayName || ""))}
                                      </span>
                                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />
                                    </>
                                  );
                                })()}
                              </button>
                            ) : null}
                          </div>
                        )}
                        {foldersForMoveListFiltered.length === 0 ? (
                          <div className="space-y-2 px-1 py-2">
                            <p className="text-center text-xs text-muted-foreground">
                              {!moveFolderSearch.trim() && foldersForMoveList.length === 0
                                ? "No hay otras carpetas"
                                : "Sin coincidencias"}
                            </p>
                            {moveFolderSearch.trim() ? (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8 w-full text-xs"
                                onClick={() => handleCreateFolderAndMove(moveFolderSearch)}
                                disabled={createMailFolder.isPending || !selectedEmailId}
                              >
                                Crear «{moveFolderSearch.trim()}» y mover
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          foldersForMoveListFiltered.map((folder: any) => {
                            const Icon = getFolderIcon(folder.displayName);
                            const label = getFolderLabel(folder.displayName);
                            const pathStr = folderPathFromId(folder.id, folderById);
                            return (
                              <button
                                key={folder.id}
                                type="button"
                                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                                onClick={() => {
                                  if (selectedEmailId) handleMoveEmail(selectedEmailId, folder.id);
                                }}
                              >
                                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{label}</span>
                                  <span className="block truncate text-[11px] text-muted-foreground">{pathStr}</span>
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                    <div className="shrink-0 border-t border-border p-2">
                      {movePopoverCreateOpen ? (
                        <div className="flex items-center gap-1">
                          <Input
                            autoFocus
                            placeholder="Nombre de la carpeta…"
                            className="h-8 flex-1 text-xs"
                            value={moveFolderCreateName}
                            onChange={(e) => setMoveFolderCreateName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && moveFolderCreateName.trim()) {
                                handleCreateFolderAndMove(moveFolderCreateName);
                              }
                              if (e.key === "Escape") {
                                setMovePopoverCreateOpen(false);
                                setMoveFolderCreateName("");
                              }
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => {
                              if (moveFolderCreateName.trim()) handleCreateFolderAndMove(moveFolderCreateName);
                            }}
                            disabled={createMailFolder.isPending}
                            aria-label="Crear y mover"
                          >
                            {createMailFolder.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => {
                              setMovePopoverCreateOpen(false);
                              setMoveFolderCreateName("");
                            }}
                            aria-label="Cancelar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-full justify-start gap-2 text-xs"
                          onClick={() => {
                            setMovePopoverCreateOpen(true);
                            setMoveFolderCreateName("");
                          }}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                          Nueva carpeta
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => selectedEmailId && markUnread.mutate(selectedEmailId)}
                    >
                      <MailOpen className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      No leído
                      <kbd className="px-1 py-[1px] bg-muted/40 text-muted-foreground rounded text-[10px] font-mono">u</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => selectedEmailId && handleDelete(selectedEmailId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      Eliminar
                      <kbd className="px-1 py-[1px] bg-muted/40 text-muted-foreground rounded text-[10px] font-mono">#</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>

                <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1" aria-label="Acciones inteligentes">
                  {/* Kawiil AI panel toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={aiCardOpen ? "secondary" : "outline"}
                        size="sm"
                        className={cn(
                          "h-7 px-2 gap-1.5 text-xs font-medium shrink-0",
                          aiCardOpen
                            ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/15"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setAiCardOpen((v) => !v)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Kawiil AI
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {aiCardOpen ? "Cerrar panel IA" : "Abrir panel IA (resumen, respuestas, tareas)"}
                    </TooltipContent>
                  </Tooltip>

                  <div className="h-4 w-px bg-border/60 shrink-0 mx-0.5" />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => void runDetailSummarize()}
                        disabled={detailAiLoading}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">Resumir con IA</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => void runDetailTranslate()}
                        disabled={detailAiLoading}
                      >
                        <Languages className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">Traducir con IA</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setCreateTaskOpen(true)}
                      >
                        <ListTodo className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">Crear tarea</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setSendToSlackOpen(true)}
                        disabled={!emailDetail}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">Enviar a Slack</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setMailRuleDialogOpen(true)}
                        disabled={!emailDetail}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">Crear regla</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </TooltipProvider>

            {detailAiPanel && (
              <div className="px-3 sm:px-6 py-3 border-b border-border/50 shrink-0">
                <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                        {detailAiPanel === "summarize" ? (
                          <>
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                            Resumen
                          </>
                        ) : (
                          <>
                            <Languages className="h-3.5 w-3.5" aria-hidden />
                            Traducción
                          </>
                        )}
                      </span>
                      {detailAiPanel === "translate" && detailAiTranslateTarget && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-semibold tracking-wide"
                        >
                          {detailAiTranslateTarget === "en" ? "ES → EN" : "EN → ES"}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => void copyDetailAiText()}
                        disabled={detailAiLoading || !detailAiText?.trim()}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={closeDetailAiPanel}
                      >
                        Cerrar
                      </Button>
                    </div>
                  </div>
                  {detailAiLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      <span>
                        {detailAiPanel === "summarize" ? "Resumiendo…" : "Traduciendo…"}
                      </span>
                    </div>
                  ) : (
                    <div className="max-h-[40vh] overflow-y-auto pr-1 rounded-md bg-background border border-border/40 p-3">
                      {detailAiText?.trim() ? (
                        <KawiilAiMarkdown>{detailAiText}</KawiilAiMarkdown>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Sin resultado.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick AI result */}
            {quickAIPrompt && (
              <div className="px-3 sm:px-6 py-3 border-b border-border/50 shrink-0 bg-primary/[0.03]">
                <EmailAIAssistant
                  mode="quick"
                  emailSubject={emailDetail.subject || ""}
                  emailBody={emailDetail.body?.content || ""}
                  senderName={emailDetail.from?.emailAddress?.name}
                  threadContext={threadContextForAi || undefined}
                  autoPrompt={quickAIPrompt}
                  onClose={() => setQuickAIPrompt(null)}
                />
              </div>
            )}

            {/* Email body + AI side panel */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="flex-1 min-w-0">
              <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-4">
                <div className="max-w-[min(100%,680px)] mx-auto w-full rounded-2xl border-2 border-primary/15 bg-card/95 shadow-md ring-1 ring-black/[0.06] dark:ring-white/[0.08] overflow-hidden">
                  <div className="px-4 py-5 sm:px-7 sm:py-7 bg-muted/20">
                    {emailDetail.body?.contentType === "html" ? (
                      <AutoResizeIframe
                        html={iframeSafeEmailHtml}
                        title="Email content"
                        loading={bodyCidLoading}
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {emailDetail.body?.content}
                      </pre>
                    )}
                  </div>
                </div>

                {attachments.length > 0 && selectedEmailId && (
                  <div className="max-w-[min(100%,680px)] mx-auto w-full rounded-xl border border-border/50 p-4 space-y-3 bg-muted/30">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5" /> {attachments.length} adjunto{attachments.length > 1 ? "s" : ""}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {attachments
                        .filter(
                          (att: OutlookAttachment) =>
                            !att["@odata.type"]?.includes("itemAttachment") &&
                            !att["@odata.type"]?.includes("referenceAttachment"),
                        )
                        .map((att: OutlookAttachment) => (
                          <EmailAttachmentTile
                            key={att.id}
                            messageId={selectedEmailId}
                            att={att}
                            onPreview={setAttachmentPreview}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Thread history — below the email body */}
                {!threadHistoryLoading && hasPriorMessages && (
                  <div className="max-w-[min(100%,680px)] mx-auto w-full rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <ListOrdered className="h-3.5 w-3.5" />
                        {otherThreadEmails.length} mensaje{otherThreadEmails.length > 1 ? "s" : ""} anteriores en este hilo
                      </p>
                      <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setThreadExpandAll((v) => !v)}>
                        {threadExpandAll ? "Contraer" : "Expandir"}
                      </Button>
                    </div>
                    <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-0.5">
                      {otherThreadEmails.map((threadEmail: any) => (
                        <ThreadEmailItem
                          key={threadEmail.id}
                          email={threadEmail}
                          onPreviewAttachment={setAttachmentPreview}
                          expandAll={threadExpandAll}
                          onExitExpandAll={() => setThreadExpandAll(false)}
                        />
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </ScrollArea>

            {/* Kawiil AI right panel — visible when aiCardOpen */}
            {aiCardOpen && selectedEmailId && (
              <div className="w-[320px] shrink-0 border-l border-border/40 overflow-y-auto bg-muted/10">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 sticky top-0 bg-background/80 backdrop-blur-sm z-10">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Kawiil AI
                  </span>
                  <button
                    type="button"
                    onClick={() => setAiCardOpen(false)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  <EmailKawiilCard
                    emailId={selectedEmailId}
                    subject={emailDetail.subject || ""}
                    senderName={emailDetail.from?.emailAddress?.name}
                    senderEmail={emailDetail.from?.emailAddress?.address}
                    body={emailDetail.body?.content || ""}
                    thread={threadContextForAi || undefined}
                    onUseReply={(text) => {
                      if (emailAction !== "reply") handleStartReply("reply");
                      const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
                      setDraftHtml(safe);
                    }}
                    onCreateTask={() => setCreateTaskOpen(true)}
                    onSummaryReady={(s) => setEmailAiSummary({ summary: s.summary, suggestedAction: s.suggestedAction })}
                  />
                </div>
              </div>
            )}
            </div>

          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">No hay datos para este mensaje.</p>
            <Button variant="outline" size="sm" onClick={() => setSelectedEmailId(null)}>
              Volver a la lista
            </Button>
          </div>
        )}
      </div>
      <EmailInboxAiPanel
        open={aiInboxOpen}
        onClose={() => setAiInboxOpen(false)}
        emails={allEmails as any}
        onOpenEmail={(email) => {
          handleOpenEmail(email);
        }}
        folderLabel={
          resolvedSelectedFolder?.id
            ? folderPathFromId(resolvedSelectedFolder.id, folderById)
            : (sortedFolders.find((f: any) => f.id === selectedFolderId)?.displayName ?? undefined)
        }
      />
      </div>
    </div>

      <AttachmentPreviewDialog
        preview={attachmentPreview}
        onClose={() => setAttachmentPreview(null)}
      />

      <CreateTaskFromEmailDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        emailSubject={emailDetail?.subject}
        senderName={emailDetail?.from?.emailAddress?.name}
        senderEmail={emailDetail?.from?.emailAddress?.address}
        bodyPreview={emailDetail?.bodyPreview}
        bodyHtml={
          emailDetail?.body?.contentType === "html"
            ? emailDetail?.body?.content
            : undefined
        }
        bodyText={
          emailDetail?.body?.contentType === "text"
            ? emailDetail?.body?.content
            : undefined
        }
        receivedDate={emailDetail?.receivedDateTime ? formatDistanceToNow(parseISO(emailDetail.receivedDateTime), { addSuffix: true, locale: es }) : undefined}
        receivedAtISO={emailDetail?.receivedDateTime ?? undefined}
        aiSummary={emailAiSummary?.summary ?? null}
        aiSuggestedAction={emailAiSummary?.suggestedAction ?? null}
      />
      <SendEmailToSlackDialog
        open={sendToSlackOpen}
        onOpenChange={setSendToSlackOpen}
        subject={emailDetail?.subject ?? ""}
        senderLabel={
          emailDetail?.from?.emailAddress?.name ||
          emailDetail?.from?.emailAddress?.address ||
          "Remitente desconocido"
        }
        webLink={(emailDetail as { webLink?: string | null } | undefined)?.webLink ?? null}
        aiSummary={emailAiSummary?.summary ?? null}
        aiSuggestedAction={emailAiSummary?.suggestedAction ?? null}
      />

      {/* Quick task creation from email list (without opening the email) */}
      <CreateTaskFromEmailDialog
        open={!!quickTaskEmail}
        onOpenChange={(o) => { if (!o) setQuickTaskEmail(null); }}
        emailSubject={quickTaskEmail?.subject}
        senderName={quickTaskEmail?.senderName}
        senderEmail={quickTaskEmail?.senderEmail}
        bodyPreview={quickTaskEmail?.bodyPreview}
        receivedDate={quickTaskEmail?.receivedDateTime ? formatDistanceToNow(parseISO(quickTaskEmail.receivedDateTime), { addSuffix: true, locale: es }) : undefined}
        receivedAtISO={quickTaskEmail?.receivedDateTime ?? undefined}
      />

      {emailAction && selectedEmailId && (
        <ReplyForwardDialog
          open
          onOpenChange={(o) => {
            if (!o) resetAction();
          }}
          action={emailAction}
          emailDetail={(emailDetail ?? {}) as Record<string, unknown>}
          threadContextForAi={threadContextForAi}
          draftId={draftId}
          draftHtml={draftHtml}
          setDraftHtml={setDraftHtml}
          forwardTo={forwardTo}
          setForwardTo={setForwardTo}
          forwardCc={forwardCc}
          setForwardCc={setForwardCc}
          forwardBcc={forwardBcc}
          setForwardBcc={setForwardBcc}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          replyCc={replyCc}
          setReplyCc={setReplyCc}
          replyBcc={replyBcc}
          setReplyBcc={setReplyBcc}
          replyFiles={replyFiles}
          onReplyFilesChange={setReplyFiles}
          createReplyDraftPending={createReplyDraft.isPending}
          createForwardDraftPending={createForwardDraft.isPending}
          isSending={isSending}
          isScheduling={scheduleSubmitting}
          onCancel={resetAction}
          onSend={handleSendReply}
          onScheduleMail={handleScheduleMail}
          requestDeliveryReceipt={requestDeliveryReceipt}
          requestReadReceipt={requestReadReceipt}
          onRequestDeliveryReceiptChange={setRequestDeliveryReceipt}
          onRequestReadReceiptChange={setRequestReadReceipt}
          receiptsDisabled={!draftId}
        />
      )}
      <ComposeEmailDialog open={composeOpen} onOpenChange={setComposeOpen} onAfterSend={handleAfterSendTemplate} />

      <CreateMailRuleDialog
        open={mailRuleDialogOpen}
        onOpenChange={setMailRuleDialogOpen}
        senderEmail={emailDetail?.from?.emailAddress?.address ?? ""}
        senderName={emailDetail?.from?.emailAddress?.name ?? undefined}
        folders={foldersForMoveList as Array<{ id: string; displayName: string }>}
      />
    </>
  );
}

function AttachmentPreviewDialog({
  preview,
  onClose,
}: {
  preview: AttachmentPreviewState | null;
  onClose: () => void;
}) {
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxErr, setDocxErr] = useState<string | null>(null);
  const [sheetData, setSheetData] = useState<EmailSheetPreviewData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetErr, setSheetErr] = useState<string | null>(null);

  useEffect(() => {
    if (!preview || preview.kind !== "docx") {
      setDocxHtml(null);
      setDocxErr(null);
      setDocxLoading(false);
      return;
    }
    const blob = preview.sourceBlob;
    if (!blob) {
      setDocxErr("No hay datos del adjunto para previsualizar.");
      setDocxHtml(null);
      setDocxLoading(false);
      return;
    }
    if (blob.size > EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES) {
      setDocxErr(
        "El archivo supera el límite de vista previa (20 MB). Descárgalo para abrirlo en Word u otra aplicación.",
      );
      setDocxHtml(null);
      setDocxLoading(false);
      return;
    }
    let cancelled = false;
    setDocxLoading(true);
    setDocxErr(null);
    setDocxHtml(null);
    void (async () => {
      try {
        const mammoth = await import("mammoth");
        const arrayBuffer = await blob.arrayBuffer();
        const { value } = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setDocxHtml(DOMPurify.sanitize(value, { USE_PROFILES: { html: true } }));
      } catch (e) {
        if (!cancelled) {
          setDocxErr(e instanceof Error ? e.message : "No se pudo convertir el documento.");
        }
      } finally {
        if (!cancelled) setDocxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    if (!preview || preview.kind !== "sheet") {
      setSheetData(null);
      setSheetErr(null);
      setSheetLoading(false);
      return;
    }
    const blob = preview.sourceBlob;
    if (!blob) {
      setSheetErr("No hay datos del adjunto para previsualizar.");
      setSheetData(null);
      setSheetLoading(false);
      return;
    }
    if (blob.size > EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES) {
      setSheetErr(
        "El archivo supera el límite de vista previa (20 MB). Descárgalo para abrirlo en Excel u otra aplicación.",
      );
      setSheetData(null);
      setSheetLoading(false);
      return;
    }
    let cancelled = false;
    setSheetLoading(true);
    setSheetErr(null);
    setSheetData(null);
    void (async () => {
      try {
        const data = await buildEmailSheetPreview(blob, preview.name || "adjunto");
        if (!cancelled) setSheetData(data);
      } catch (e) {
        if (!cancelled) {
          setSheetErr(e instanceof Error ? e.message : "No se pudo leer la hoja de cálculo.");
        }
      } finally {
        if (!cancelled) setSheetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const handleDownload = () => {
    if (!preview?.url) return;
    triggerBlobDownload(preview.url, preview.name || "adjunto");
  };

  return (
    <Dialog open={!!preview} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 space-y-3">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="truncate flex-1 min-w-0">{preview?.name ?? "Vista previa"}</DialogTitle>
            {preview ? (
              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={handleDownload}>
                <Download className="h-4 w-4" />
                Descargar
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-md border bg-muted/20">
          {preview?.kind === "image" && (
            <div className="p-3 flex justify-center">
              <img src={preview.url} alt="" className="max-w-full h-auto rounded-md border" />
            </div>
          )}
          {preview?.kind === "pdf" && (
            <iframe src={preview.url} className="w-full min-h-[70vh] rounded-md border-0" title={preview.name} />
          )}
          {preview?.kind === "docx" && (
            <div className="p-4">
              {docxLoading && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                  Convirtiendo documento…
                </div>
              )}
              {!docxLoading && docxErr && (
                <p className="text-sm text-destructive/90 whitespace-pre-wrap">{docxErr}</p>
              )}
              {!docxLoading && !docxErr && docxHtml && (
                <div
                  className="email-docx-preview prose prose-sm dark:prose-invert max-w-none text-foreground [&_p]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5"
                  dangerouslySetInnerHTML={{ __html: docxHtml }}
                />
              )}
              {!docxLoading && !docxErr && !docxHtml && preview.sourceBlob && (
                <p className="text-sm text-muted-foreground">Sin contenido para mostrar.</p>
              )}
            </div>
          )}
          {preview?.kind === "sheet" && (
            <div className="flex flex-col min-h-0">
              {sheetLoading && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground px-4">
                  <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                  Leyendo tabla…
                </div>
              )}
              {!sheetLoading && sheetErr && (
                <p className="text-sm text-destructive/90 whitespace-pre-wrap px-4 py-3">{sheetErr}</p>
              )}
              {!sheetLoading && !sheetErr && sheetData && (
                <>
                  <p className="text-xs text-muted-foreground px-4 pt-3 pb-2 shrink-0 border-b border-border/50">
                    Hoja «{sheetData.sheetName}»
                    {sheetData.extraSheets > 0
                      ? ` · ${sheetData.extraSheets} hoja(s) más en el archivo (solo se muestra la primera)`
                      : ""}
                    {sheetData.truncatedRows || sheetData.truncatedCols
                      ? " · Vista truncada (filas/columnas). Descarga el archivo para ver todo."
                      : ""}
                  </p>
                  <div className="overflow-auto max-h-[min(70vh,640px)] px-2 pb-3">
                    {sheetData.rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-3">Sin filas de datos.</p>
                    ) : (
                      <table className="w-max min-w-full text-xs border-collapse">
                        <tbody>
                          {sheetData.rows.map((row, i) => (
                            <tr
                              key={i}
                              className={
                                i === 0
                                  ? "bg-muted/70 font-medium"
                                  : i % 2 === 0
                                    ? "bg-background"
                                    : "bg-muted/20"
                              }
                            >
                              {row.map((cell, j) => (
                                <td
                                  key={j}
                                  className="border border-border px-2 py-1 align-top whitespace-nowrap max-w-[220px] truncate"
                                  title={cell}
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {preview?.kind === "other" && (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">
                Vista previa no disponible para este tipo de archivo en el navegador. Usa «Descargar» en la tarjeta del
                adjunto para abrirlo en tu equipo.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmailAttachmentTile({
  messageId,
  att,
  onPreview,
}: {
  messageId: string;
  att: OutlookAttachment;
  onPreview: (state: AttachmentPreviewState) => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [dataBlob, setDataBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errHint, setErrHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    setLoading(true);
    setError(false);
    setErrHint(null);
    setBlobUrl(null);
    setDataBlob(null);
    (async () => {
      try {
        const r = await fetchMessageAttachmentBlob(messageId, att.id);
        const fromApi = (r.contentType || "").toLowerCase();
        const inferred = inferMimeFromFileName(att.name || r.name || "");
        const mime =
          fromApi && fromApi !== "application/octet-stream"
            ? r.contentType
            : inferred || att.contentType || "application/octet-stream";
        const finalBlob = new Blob([r.blob], { type: mime });
        created = URL.createObjectURL(finalBlob);
        if (alive) {
          setBlobUrl(created);
          setDataBlob(finalBlob);
        }
      } catch (e) {
        if (alive) {
          setError(true);
          setErrHint(e instanceof Error ? e.message.slice(0, 220) : "Error al cargar");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [messageId, att.id, att.contentType, att.name]);

  const effectiveMime = (() => {
    const a = (att.contentType || "").toLowerCase();
    if (a && a !== "application/octet-stream") return a;
    return (inferMimeFromFileName(att.name || "") || a || "").toLowerCase();
  })();
  const isImage = effectiveMime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(att.name || "");
  const isPdf = effectiveMime.includes("pdf") || att.name?.toLowerCase().endsWith(".pdf");
  const isDocx =
    effectiveMime.includes("wordprocessingml") ||
    /\.docx$/i.test(att.name || "");
  const isSheet =
    /\.(xlsx|xlsm|xls|csv|tsv)$/i.test(att.name || "") ||
    effectiveMime.includes("spreadsheetml") ||
    effectiveMime.includes("spreadsheet") ||
    effectiveMime === "application/vnd.ms-excel" ||
    effectiveMime === "text/csv" ||
    effectiveMime === "text/tab-separated-values" ||
    effectiveMime === "application/csv";

  const openPreviewOnly = () => {
    const name = att.name || "adjunto";
    if (isImage) {
      onPreview({ url: blobUrl, name, kind: "image" });
      return;
    }
    if (isPdf) {
      onPreview({ url: blobUrl, name, kind: "pdf" });
      return;
    }
    if (isDocx) {
      if (att.size > EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES) {
        toast.error("Archivo demasiado grande para vista previa (máx. 20 MB). Usa Descargar.");
        return;
      }
      if (!dataBlob) return;
      onPreview({ url: blobUrl, name, kind: "docx", sourceBlob: dataBlob });
      return;
    }
    if (isSheet) {
      if (att.size > EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES) {
        toast.error("Archivo demasiado grande para vista previa (máx. 20 MB). Usa Descargar.");
        return;
      }
      if (!dataBlob) return;
      onPreview({ url: blobUrl, name, kind: "sheet", sourceBlob: dataBlob });
      return;
    }
    onPreview({ url: blobUrl, name, kind: "other" });
  };

  if (loading) {
    return <div className="h-36 w-full max-w-[220px] rounded-lg border bg-muted animate-pulse" />;
  }

  if (error || !blobUrl) {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-lg border bg-background text-sm text-muted-foreground max-w-[220px]">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate" title={att.name}>
            {att.name}
          </span>
        </div>
        {errHint && <p className="text-[10px] leading-snug text-destructive/90 break-words">{errHint}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border bg-background overflow-hidden max-w-[220px] shadow-sm">
      {isImage && (
        <button
          type="button"
          className="relative block w-full p-0 border-0 bg-transparent cursor-pointer group"
          onClick={openPreviewOnly}
        >
          <img src={blobUrl} alt="" className="max-h-40 w-full object-contain bg-muted/30" />
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/35 transition-opacity">
            <Eye className="h-7 w-7 text-white" />
          </span>
        </button>
      )}
      {isPdf && !isImage && (
        <div className="border-b bg-muted/20">
          <iframe src={blobUrl} className="w-full h-44 border-0" title={att.name} />
        </div>
      )}
      {!isImage && !isPdf && (
        <div className="flex items-center justify-center h-28 bg-muted/40 border-b">
          <FileText className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <div className="flex flex-col gap-1.5 px-2 py-2">
        <span className="text-xs text-muted-foreground truncate" title={att.name}>
          {att.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {att.size > 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(att.size / 1024)} KB`}
        </span>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => triggerBlobDownload(blobUrl, att.name || "adjunto")}
          >
            <Download className="h-3 w-3" /> Descargar
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={openPreviewOnly}
          >
            <Eye className="h-3 w-3" /> Abrir
          </Button>
        </div>
      </div>
    </div>
  );
}

function ThreadEmailItem({
  email,
  onPreviewAttachment,
  expandAll = false,
  onExitExpandAll,
}: {
  email: any;
  onPreviewAttachment: (p: AttachmentPreviewState) => void;
  expandAll?: boolean;
  onExitExpandAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = expandAll || open;
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && expandAll) onExitExpandAll?.();
  };
  const senderName = email.from?.emailAddress?.name || email.from?.emailAddress?.address;
  const senderEmail = email.from?.emailAddress?.address || "";
  const { data: threadAttachments = [] } = useEmailAttachments(isOpen ? email.id : undefined);
  const { html: resolvedThreadHtml, loading: threadBodyLoading } = useResolvedEmailHtml(
    isOpen ? email.id : undefined,
    email.body?.contentType === "html" ? email.body.content : undefined,
    threadAttachments,
  );
  const iframeSafeThreadHtml = useMemo(
    () => sanitizeEmailBodyForIframe(resolvedThreadHtml || ""),
    [resolvedThreadHtml],
  );

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-lg transition-colors text-left">
          <div className={cn("h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0", getAvatarColor(senderEmail))}>
            {getInitials(senderName, senderEmail)}
          </div>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="font-medium text-foreground truncate">{senderName}</span>
          <span className="text-muted-foreground truncate flex-1">— {email.bodyPreview?.substring(0, 60)}</span>
          <span className="text-xs text-muted-foreground font-normal whitespace-nowrap shrink-0">
            {formatEmailDate(emailListTimestamp(email))}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-10 mr-2 mb-2 space-y-3">
          <div className="border border-border/50 rounded-lg overflow-hidden">
            {email.body?.contentType === "html" ? (
              <AutoResizeIframe
                html={iframeSafeThreadHtml}
                title="Thread email"
                minH={100}
                loading={threadBodyLoading}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm p-3 text-muted-foreground">{email.body?.content}</pre>
            )}
          </div>
          {threadAttachments.length > 0 && email.id && (
            <div className="rounded-xl border border-border/50 p-3 space-y-2 bg-muted/20">
              <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                <Paperclip className="h-3 w-3" /> {threadAttachments.length} adjunto
                {threadAttachments.length > 1 ? "s" : ""}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {threadAttachments
                  .filter(
                    (att: OutlookAttachment) =>
                      !att["@odata.type"]?.includes("itemAttachment") &&
                      !att["@odata.type"]?.includes("referenceAttachment"),
                  )
                  .map((att: OutlookAttachment) => (
                    <EmailAttachmentTile
                      key={att.id}
                      messageId={email.id}
                      att={att}
                      onPreview={onPreviewAttachment}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Tema oscuro según atributo `data-theme="dark"` en &lt;html&gt; (next-themes). */
function useDocumentDarkClass(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.dataset.theme === "dark");
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function AutoResizeIframe({
  html,
  title,
  minH = 200,
  loading,
}: {
  html: string;
  title: string;
  minH?: number;
  loading?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minH);
  const isDark = useDocumentDarkClass();

  const srcDoc = useMemo(() => {
    const bodyBg = isDark ? "#0f1419" : "#f8fafc";
    const bodyFg = isDark ? "#e8eaed" : "#1e293b";
    const link = isDark ? "#60a5fa" : "#2563eb";
    const quoteBorder = isDark ? "#334155" : "#e2e8f0";
    const quoteFg = isDark ? "#94a3b8" : "#64748b";
    const safe = html.replace(/<\/script/gi, "<\\/script");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${isDark ? "dark" : "light"}"><style>
      html,body{margin:0;padding:0}
      body{font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;font-size:14px;background:${bodyBg};color:${bodyFg};padding:16px 4px;word-wrap:break-word;line-height:1.65;overflow:hidden;box-sizing:border-box}
      img,video{max-width:100%;height:auto}
      a{color:${link}}
      table{max-width:100%;border-collapse:collapse}
      blockquote{border-left:3px solid ${quoteBorder};margin:8px 0;padding:4px 12px;color:${quoteFg}}
    </style></head><body>${safe}</body></html>`;
  }, [html, isDark]);

  const resizeIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc?.body) {
        const h = doc.body.scrollHeight + 24;
        setHeight(Math.max(h, minH));
      }
    } catch { /* cross-origin guard */ }
  }, [minH]);

  useEffect(() => {
    resizeIframe();
  }, [srcDoc, resizeIframe]);

  return (
    <div className="relative w-full">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/60 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups"
        title={title}
        className="w-full border-0 bg-transparent rounded-md"
        style={{ height: `${height}px` }}
        onLoad={resizeIframe}
      />
    </div>
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Para: evita alias técnico (sin espacios ni @) y muestra el email real */
function recipientToFieldDisplay(r: { emailAddress?: { name?: string; address?: string } } | null | undefined): string {
  const name = (r?.emailAddress?.name || "").trim();
  const address = (r?.emailAddress?.address || "").trim();
  const display =
    name && (name.includes(" ") || name.includes("@")) ? name : address || name;
  return display;
}

/** Cuerpo del mensaje Graph como texto plano para IA */
function emailBodyToPlain(content: string, contentType?: string): string {
  if (!content?.trim()) return "";
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("html")) return stripTags(content).replace(/\s+/g, " ").trim();
  return content.trim();
}

const OUTLOOK_CATEGORY_HUE: Record<string, number> = {
  preset0: 0, preset1: 30, preset2: 50, preset3: 75, preset4: 100,
  preset5: 130, preset6: 165, preset7: 195, preset8: 220, preset9: 250,
  preset10: 270, preset11: 295, preset12: 320, preset13: 340, preset14: 350,
  preset15: 25, preset16: 45, preset17: 55, preset18: 110, preset19: 145,
  preset20: 190, preset21: 230, preset22: 285, preset23: 310, preset24: 215,
};

function outlookCategoryColorToHsl(color?: string | null): string {
  if (!color) return "hsl(var(--primary))";
  const hue = OUTLOOK_CATEGORY_HUE[color] ?? 220;
  return `hsl(${hue} 70% 50%)`;
}

/** Heurística: si parece español → traducir al inglés (en); si no → al español (es) */
function inferTranslationTarget(plain: string): "en" | "es" {
  const t = plain.toLowerCase().slice(0, 12_000);
  const esHits =
    (t.match(
      /\b(el|la|los|las|que|de|y|en|un|una|para|con|por|está|este|esta|gracias|saludos|cordialmente|atentamente|fecha|número|reunión|estimado|estimada)\b/g,
    ) || []).length;
  const enHits =
    (t.match(/\b(the|and|is|are|to|of|for|with|this|that|thank|thanks|regards|best|dear|hi|hello|meeting|please)\b/g) || []).length;
  return esHits >= enHits ? "en" : "es";
}
