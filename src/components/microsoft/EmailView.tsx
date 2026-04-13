import { useState, useCallback, useEffect, useRef, useMemo, type DragEvent } from "react";
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
  SCHEDULED_MAIL_JOBS_QUERY_KEY,
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
  Keyboard, ArrowDown, ChevronsLeft, ChevronsRight, Maximize2, List,
  Eye, Download, CalendarClock,
} from "lucide-react";
import DOMPurify from "dompurify";
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
import { EmailAIAssistant } from "./EmailAIAssistant";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { ReplyForwardDialog } from "./ReplyForwardDialog";
import { buildThreadContextForAi } from "@/lib/emailThreadContext";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  filesToComposerAttachments,
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
  const wellKnown: any[] = [];
  const custom: any[] = [];
  for (const f of folders) {
    const key = (f.displayName || "").toLowerCase().replace(/\s/g, "");
    const isWK = WELL_KNOWN_ORDER.some(wk => key.includes(wk)) ||
      key.includes("inbox") || key.includes("bandeja") ||
      key.includes("sent") || key.includes("enviado") ||
      key.includes("draft") || key.includes("borrador") ||
      key.includes("deleted") || key.includes("eliminad") ||
      key.includes("junk") || key.includes("spam") || key.includes("correo no deseado");
    if (isWK) wellKnown.push(f);
    else custom.push(f);
  }
  return [...wellKnown, ...custom];
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

/** Versión UI del lector (visible en inspección; útil para comprobar deploy en Lovable/preview). */
export const EMAIL_VIEW_LAYOUT_VERSION = "2026.04-readerv22-sheet-csv-preview";

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

function readFoldersCollapsedPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_EMAIL_FOLDERS_COLLAPSED) === "1";
  } catch {
    return false;
  }
}

export function EmailView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailAction, setEmailAction] = useState<EmailAction>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showFullAI, setShowFullAI] = useState(false);
  const [quickAIPrompt, setQuickAIPrompt] = useState<string | null>(null);
  const [detailAiPanel, setDetailAiPanel] = useState<null | "summarize" | "translate">(null);
  const [detailAiLoading, setDetailAiLoading] = useState(false);
  const [detailAiText, setDetailAiText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftHtml, setDraftHtml] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState | null>(null);
  const [replyAttachments, setReplyAttachments] = useState<ComposerAttachment[]>([]);
  const [showFolders, setShowFolders] = useState(false);
  /** Escritorio: panel de carpetas estrecho solo con iconos */
  const [foldersCollapsed, setFoldersCollapsed] = useState(readFoldersCollapsedPref);
  /** Escritorio: oculta la lista al leer un correo para ampliar el lector */
  const [listPaneCollapsed, setListPaneCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LS_EMAIL_FOLDERS_COLLAPSED, foldersCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [foldersCollapsed]);

  useEffect(() => {
    if (!selectedEmailId) setListPaneCollapsed(false);
  }, [selectedEmailId]);

  const { data: folders = [] } = useMailFolders();
  const draftsFolderId = useMemo(() => {
    const f = (folders as { id?: string; displayName?: string; wellKnownName?: string }[]).find((x) => {
      const wk = typeof x.wellKnownName === "string" ? x.wellKnownName.toLowerCase() : "";
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
  const { data: threadEmails = [] } = useEmailConversation(emailDetail?.conversationId || null);
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();
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

  const sortedFolders = sortFolders(folders);

  const handleMoveEmail = useCallback((messageId: string, destinationId: string) => {
    moveEmail.mutate({ messageId, destinationId }, {
      onSuccess: () => {
        if (selectedEmailId === messageId) {
          const idx = allEmails.findIndex((e: any) => e.id === messageId);
          const next = allEmails[idx + 1] || allEmails[idx - 1];
          setSelectedEmailId(next?.id || null);
          resetAction();
        }
        setMovePopoverOpen(false);
      },
    });
  }, [moveEmail, selectedEmailId, allEmails]);

  const handleOpenEmail = useCallback((email: any) => {
    setSelectedEmailId(email.id);
    resetAction();
    setQuickAIPrompt(null);
    setShowFullAI(false);
    if (!email.isRead) markRead.mutate(email.id);
  }, [markRead]);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__emailSearchTimeout);
    (window as any).__emailSearchTimeout = setTimeout(() => setDebouncedSearch(val), 500);
  };

  const handleStartReply = async (action: EmailAction) => {
    if (!selectedEmailId || !action) return;
    setEmailAction(action);
    setShowFullAI(false);
    setDraftId(null);
    setDraftHtml("");
    setReplyAttachments([]);
    if (action === "forward") {
      try {
        const draft = await createForwardDraft.mutateAsync({ messageId: selectedEmailId });
        if (draft?.id) {
          setDraftId(draft.id);
          setDraftHtml(draft.body?.content || "");
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
        toast.warning(draft.message);
        return;
      }
      const d = draft as { id?: string; body?: { content?: string } };
      if (d?.id) {
        setDraftId(d.id);
        setDraftHtml(d.body?.content || "");
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
    if (emailAction === "forward") {
      const forwardRecipients = parseRecipients(forwardTo);
      const err = validateRecipientGroups({ to: forwardRecipients });
      if (err) {
        toast.error(err);
        return;
      }
    }
    let attachments = replyAttachments;
    const attBytes = attachments.reduce((n, a) => n + (a.contentBytes?.length || 0), 0);
    if (attBytes > 3 * 1024 * 1024) {
      toast.warning("Adjuntos omitidos del envío programado (superan 3 MB en base64).");
      attachments = [];
    }
    setScheduleSubmitting(true);
    try {
      const toRecipients =
        emailAction === "forward"
          ? parseRecipients(forwardTo).map((email) => ({ emailAddress: { address: email } }))
          : undefined;

      const { error } = await supabase.from("scheduled_mail_jobs").insert({
        user_id: user.id,
        scheduled_at: when.toISOString(),
        draft_id: draftId,
        kind: "send_draft",
        payload: {
          body_html: draftHtml,
          ...(toRecipients?.length ? { to_recipients: toRecipients } : {}),
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
      const forwardRecipients = parseRecipients(forwardTo);
      const error = validateRecipientGroups({ to: forwardRecipients });
      if (error) {
        toast.error(error);
        return;
      }
      if (draftId) {
        sendDraft.mutate(
          {
            draftId,
            body: { contentType: "HTML", content: draftHtml },
            attachments: replyAttachments,
            toRecipients: forwardRecipients.map((email) => ({ emailAddress: { address: email } })),
          },
          { onSuccess: resetAction }
        );
      } else {
        forwardEmail.mutate(
          {
            messageId: selectedEmailId,
            comment: stripTags(draftHtml),
            toRecipients: forwardRecipients,
            attachments: replyAttachments,
          },
          { onSuccess: resetAction }
        );
      }
      return;
    }
    if (draftId) {
      sendDraft.mutate(
        { draftId, body: { contentType: "HTML", content: draftHtml }, attachments: replyAttachments },
        { onSuccess: resetAction }
      );
    } else {
      replyEmail.mutate(
        { messageId: selectedEmailId, comment: stripTags(draftHtml), replyAll: emailAction === "reply-all" },
        { onSuccess: resetAction }
      );
    }
  };

  const resetAction = () => {
    setEmailAction(null);
    setDraftHtml("");
    setDraftId(null);
    setForwardTo("");
    setShowFullAI(false);
    setReplyAttachments([]);
  };

  const handleReplyAttachmentPick = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const parsed = await filesToComposerAttachments(files);
      setReplyAttachments((prev) => {
        const merged = [...prev];
        for (const item of parsed) {
          if (!merged.some((existing) => existing.name === item.name && existing.size === item.size)) {
            merged.push(item);
          }
        }
        return merged;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron adjuntar archivos");
    }
  };

  const removeReplyAttachment = useCallback((file: ComposerAttachment) => {
    setReplyAttachments((prev) => prev.filter((f) => !(f.name === file.name && f.size === file.size)));
  }, []);

  const handleArchive = useCallback((emailId: string) => {
    const idx = allEmails.findIndex((e: any) => e.id === emailId);
    const next = allEmails[idx + 1] || allEmails[idx - 1];
    if (selectedEmailId === emailId) {
      setSelectedEmailId(next?.id || null);
      resetAction();
    }
    archiveEmail.mutate(emailId);
  }, [archiveEmail, allEmails, selectedEmailId]);

  const handleDelete = useCallback((emailId: string) => {
    const idx = allEmails.findIndex((e: any) => e.id === emailId);
    const next = allEmails[idx + 1] || allEmails[idx - 1];
    if (selectedEmailId === emailId) {
      setSelectedEmailId(next?.id || null);
      resetAction();
    }
    deleteEmail.mutate(emailId);
  }, [deleteEmail, allEmails, selectedEmailId]);

  const closeDetailAiPanel = useCallback(() => {
    setDetailAiPanel(null);
    setDetailAiLoading(false);
    setDetailAiText("");
  }, []);

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
    replyAttachments,
    handleSendReply,
    handleStartReply,
    markUnread,
    resetAction,
  ]);

  const isSending =
    replyEmail.isPending ||
    forwardEmail.isPending ||
    sendDraft.isPending ||
    createForwardDraft.isPending;
  const otherThreadEmails = threadEmails.filter((e: any) => e.id !== selectedEmailId);

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
      if (isMobile) setShowFolders(false);
    };
    return { Icon, label, isActive, folderBadge, dragHandlers, onSelect };
  };

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
        <div
          className="hidden shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 md:flex"
          data-kawiil-email-toolbar="1"
        >
            <span className="text-xs font-medium text-muted-foreground">Paneles</span>
            <Button
              type="button"
              variant={foldersCollapsed ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium shadow-sm"
              onClick={() => setFoldersCollapsed((c) => !c)}
            >
              {foldersCollapsed ? (
                <>
                  <ChevronsRight className="h-3.5 w-3.5" />
                  Ver carpetas
                </>
              ) : (
                <>
                  <ChevronsLeft className="h-3.5 w-3.5" />
                  Solo iconos
                </>
              )}
            </Button>
            <Button
              type="button"
              variant={listPaneCollapsed ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium shadow-sm"
              disabled={!selectedEmailId}
              title={!selectedEmailId ? "Abre un correo para usar esta opción" : undefined}
              onClick={() => {
                if (selectedEmailId) setListPaneCollapsed((c) => !c);
              }}
            >
              {listPaneCollapsed ? (
                <>
                  <List className="h-3.5 w-3.5" />
                  Mostrar lista
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  Ampliar lector
                </>
              )}
            </Button>
            <span
              className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums"
              title="Si no cambia tras deploy, Lovable aún muestra un bundle antiguo."
            >
              {EMAIL_VIEW_LAYOUT_VERSION}
            </span>
        </div>
        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-row overflow-hidden bg-background">
      {/* Folder sidebar — móvil: overlay; escritorio: expandible o riel de iconos */}
      <div
        className={cn(
          "relative z-[1] flex min-h-0 flex-col border-r border-border bg-muted/30 transition-[width] duration-200 ease-out",
          isMobile
            ? cn(showFolders ? "absolute z-30 h-full w-56 shadow-xl" : "w-0 shrink-0 overflow-hidden border-0")
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
            <ScrollArea className="min-h-0 flex-1">
              <div className="py-1 pr-2.5 pl-1">
                {sortedFolders.map((folder: any) => {
                  const { Icon, label, isActive, folderBadge, dragHandlers, onSelect } = folderRow(folder);
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      className={cn(
                        "flex min-w-0 w-full items-center gap-2 py-2 pl-2 pr-1 text-sm transition-all hover:bg-accent/60 text-left rounded-none",
                        isActive && "bg-accent text-accent-foreground font-medium border-l-2 border-primary",
                        dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary",
                      )}
                      onClick={onSelect}
                      {...dragHandlers}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                      {folderBadge != null && folderBadge > 0 && (
                        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-bold tabular-nums bg-primary/15 text-primary">
                          {folderBadge}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
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
                  <div className="flex flex-col items-center gap-0.5 py-1 pl-0.5 pr-1">
                    {sortedFolders.map((folder: any) => {
                      const { Icon, label, isActive, folderBadge, dragHandlers, onSelect } = folderRow(folder);
                      return (
                        <Tooltip key={folder.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-md transition-colors hover:bg-accent/60",
                                isActive && "bg-accent text-accent-foreground ring-1 ring-primary",
                                dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary",
                              )}
                              onClick={onSelect}
                              {...dragHandlers}
                            >
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              {folderBadge != null && folderBadge > 0 && (
                                <span className="absolute right-0 top-0 flex h-4 min-w-[1.125rem] translate-x-0.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold tabular-nums text-primary-foreground">
                                  {folderBadge > 9 ? "9+" : folderBadge}
                                </span>
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">{label}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </ScrollArea>
                <div className="flex shrink-0 justify-center border-t border-border p-1">
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
                <ScrollArea className="min-h-0 flex-1">
                  <div className="py-1 pr-2.5 pl-1">
                    {sortedFolders.map((folder: any) => {
                      const { Icon, label, isActive, folderBadge, dragHandlers, onSelect } = folderRow(folder);
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          className={cn(
                            "flex min-w-0 w-full items-center gap-2 rounded-none py-2 pl-2 pr-1 text-left text-sm transition-all hover:bg-accent/60",
                            isActive && "border-l-2 border-primary bg-accent font-medium text-accent-foreground",
                            dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary",
                          )}
                          onClick={onSelect}
                          {...dragHandlers}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                          {folderBadge != null && folderBadge > 0 && (
                            <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-bold tabular-nums bg-primary/15 text-primary">
                              {folderBadge}
                            </Badge>
                          )}
                        </button>
                      );
                    })}
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

      {/* Email list panel — flex + anchos fijos en escritorio (evita solapes tipo iframe/Lovable) */}
      <div
        className={cn(
          "relative z-[2] flex min-h-0 flex-col overflow-hidden border-r border-border bg-background transition-[width,opacity] duration-200 ease-out",
          isMobile
            ? "min-w-0 flex-1"
            : cn(
                "shrink-0",
                listPaneCollapsed && selectedEmailId
                  ? "pointer-events-none w-0 min-w-0 shrink-0 overflow-hidden border-0 p-0 opacity-0"
                  : "w-[min(28rem,40vw)] min-w-[17.5rem] max-w-[28rem]",
              ),
          selectedEmailId && isMobile && "hidden",
        )}
      >
        {/* Search & compose toolbar */}
        <div className="space-y-2 border-b border-border/50 p-3">
          <TooltipProvider delayDuration={250}>
            <div className="flex items-center gap-2">
              {isMobile && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowFolders(true)}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar correos..."
                  className="h-9 border-0 bg-muted/40 pl-9 text-sm focus-visible:ring-1"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                />
              </div>
              <Button size="sm" className="h-9 shrink-0 gap-2 px-4" onClick={() => setComposeOpen(true)}>
                <Send className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Redactar</span>
              </Button>
            </div>
          </TooltipProvider>
        </div>

        {/* Lista con scroll + pie fijo para «más correos» (siempre visible) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="min-h-0 flex-1 px-0" ref={listRef}>
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
              <p className="text-xs text-muted-foreground/60 mt-1">Esta carpeta está vacía</p>
            </div>
          ) : (
            <div className="px-0">
              {allEmails.map((email: any) => {
                const isActive = selectedEmailId === email.id;
                const unread = !email.isRead;
                const senderName = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Desconocido";
                const senderEmail = email.from?.emailAddress?.address || "";
                const subject = email.subject || "(sin asunto)";
                const bodyPreview = (email.bodyPreview || "").trim() || "…";
                return (
                  <div
                    key={email.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/email-id", email.id); e.dataTransfer.effectAllowed = "move"; }}
                    className={cn(
                      "group flex cursor-pointer transition-colors border-b border-border/40 px-4 py-2.5",
                      isActive && "bg-accent border-l-2 border-l-blue-500",
                      unread && !isActive && "bg-blue-50/50 dark:bg-blue-950/20",
                      !isActive && "hover:bg-muted/50",
                    )}
                    onClick={() => handleOpenEmail(email)}
                  >
                    <div className="flex gap-2.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 shrink-0 self-start">
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            unread ? "bg-blue-500" : "bg-transparent",
                          )}
                          aria-hidden
                        />
                        <div
                          className={cn(
                            "h-8 w-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shrink-0",
                            getAvatarColor(senderEmail),
                          )}
                        >
                          {getInitials(senderName, senderEmail)}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span
                            className={cn(
                              "truncate text-sm text-foreground",
                              unread ? "font-bold" : "font-normal text-foreground/85",
                            )}
                          >
                            {senderName}
                          </span>
                          <div className="relative flex shrink-0 items-center justify-end min-h-5 min-w-[4.5rem]">
                            <span
                              className={cn(
                                "text-xs text-muted-foreground tabular-nums whitespace-nowrap transition-opacity",
                                !isActive &&
                                  "max-md:opacity-100 md:opacity-100 md:group-hover:pointer-events-none md:group-hover:opacity-0",
                              )}
                            >
                              {formatEmailDate(emailListTimestamp(email))}
                            </span>
                            {!isActive && (
                              <div
                                className={cn(
                                  "flex items-center gap-0.5 rounded-sm bg-background/90 dark:bg-background/90 px-0.5",
                                  "opacity-0 group-hover:opacity-100 transition-opacity",
                                  "max-md:opacity-100 max-md:static max-md:ml-1",
                                  "md:absolute md:right-0 md:top-1/2 md:-translate-y-1/2",
                                )}
                              >
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                      onClick={(e) => { e.stopPropagation(); handleArchive(email.id); }}
                                    >
                                      <Archive className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="text-xs">Archivar (e)</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive"
                                      onClick={(e) => { e.stopPropagation(); handleDelete(email.id); }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="text-xs">Eliminar (#)</TooltipContent>
                                </Tooltip>
                                {email.isRead ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                        onClick={(e) => { e.stopPropagation(); markUnread.mutate(email.id); }}
                                      >
                                        <Mail className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="text-xs">Marcar no leído (u)</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                        onClick={(e) => { e.stopPropagation(); markRead.mutate(email.id); }}
                                      >
                                        <MailOpen className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="text-xs">Marcar leído</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1">
                          {email.hasAttachments && (
                            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden />
                          )}
                          {email.importance === "high" && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
                          )}
                          <p className="min-w-0 flex-1 truncate text-sm">
                            <span className={cn(unread && "font-semibold")}>{subject}</span>
                            <span className="text-muted-foreground font-normal"> - {bodyPreview}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

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

      {/* Detail panel — borde izquierdo de acento: visible incluso si el HTML del correo es plano */}
      <div
        className={cn(
          "relative z-[3] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
          selectedEmailId && "border-l-4 border-l-primary shadow-[4px_0_24px_-8px_hsl(var(--primary)/0.35)]",
          !selectedEmailId && isMobile && "hidden",
        )}
      >
        {!selectedEmailId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-md text-center px-2">
              <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-muted/40 mb-4">
                <Mail className="h-9 w-9 text-muted-foreground/30" />
              </div>
              <p className="text-base font-medium text-muted-foreground mb-2">Selecciona un correo</p>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground/50">
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">j</kbd><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">k</kbd> navegar</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">c</kbd> redactar</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">r</kbd> responder</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">e</kbd> archivar</span>
              </div>
              {!isMobile && (
                <p className="mt-4 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground/70">
                  Puedes contraer el panel de carpetas (««) o, al abrir un mensaje, ampliar el lector para ocultar la lista.
                </p>
              )}
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
            className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-muted/25 via-background to-background"
            data-email-layout={EMAIL_VIEW_LAYOUT_VERSION}
          >
            <div
              className="h-2.5 shrink-0 bg-gradient-to-r from-primary via-blue-500 to-sky-400"
              aria-hidden
            />
            {/* Detail header */}
            <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border/50 shrink-0 bg-background/80 backdrop-blur-sm shadow-sm">
              {(isMobile || (!isMobile && listPaneCollapsed)) && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {!isMobile && listPaneCollapsed && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setListPaneCollapsed(false)}>
                      <List className="h-3.5 w-3.5" />
                      Mostrar lista
                    </Button>
                  )}
                  {isMobile && (
                    <Button variant="ghost" size="sm" className="-ml-2 text-xs" onClick={() => setSelectedEmailId(null)}>
                      <ChevronRight className="mr-1 h-3.5 w-3.5 rotate-180" /> Volver
                    </Button>
                  )}
                </div>
              )}
              <h2 className="text-lg font-semibold text-foreground leading-tight mb-3">
                {emailDetail.subject || "(sin asunto)"}
              </h2>
              <div className="flex items-start gap-3">
                <div className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0",
                  getAvatarColor(emailDetail.from?.emailAddress?.address)
                )}>
                  {getInitials(emailDetail.from?.emailAddress?.name, emailDetail.from?.emailAddress?.address)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{emailDetail.from?.emailAddress?.name}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">&lt;{emailDetail.from?.emailAddress?.address}&gt;</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    Para:{" "}
                    {emailDetail.toRecipients?.map((r: any) => recipientToFieldDisplay(r)).filter(Boolean).join(", ") ||
                      "—"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold px-2 py-0.5 border-primary/40 bg-primary/10 text-primary tracking-tight"
                    title="Si no ves esta etiqueta, el navegador o Lovable están sirviendo un bundle antiguo."
                  >
                    {EMAIL_VIEW_LAYOUT_VERSION}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {emailDetail.receivedDateTime
                      ? format(parseISO(emailDetail.receivedDateTime), "d MMM yyyy, HH:mm", { locale: es })
                      : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Action bar: solo iconos + tooltips, sin scroll horizontal (flex-wrap) */}
            <TooltipProvider delayDuration={200}>
              <div className="flex flex-wrap items-center gap-1 px-2 sm:px-4 py-1.5 border-b border-border/50 shrink-0 bg-muted/20 min-w-0">
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
                    Responder
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
                    Todos
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
                    Reenviar
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
                    Archivar
                  </TooltipContent>
                </Tooltip>

                <Popover open={movePopoverOpen} onOpenChange={setMovePopoverOpen}>
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
                  <PopoverContent className="w-48 p-1" align="start">
                    <ScrollArea className="max-h-64">
                      {sortedFolders.filter((f: any) => f.id !== selectedFolderId).map((folder: any) => {
                        const Icon = getFolderIcon(folder.displayName);
                        const label = getFolderLabel(folder.displayName);
                        return (
                          <button
                            key={folder.id}
                            className="w-full flex items-center gap-2 px-2.5 py-2 text-sm hover:bg-accent rounded-md text-left transition-colors"
                            onClick={() => {
                              if (selectedEmailId) handleMoveEmail(selectedEmailId, folder.id);
                            }}
                          >
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{label}</span>
                          </button>
                        );
                      })}
                    </ScrollArea>
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
                    No leído
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
                    Eliminar
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-5 bg-border shrink-0 mx-0.5" aria-hidden />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                      onClick={() => void runDetailSummarize()}
                      disabled={detailAiLoading}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Resumir
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                      onClick={() => void runDetailTranslate()}
                      disabled={detailAiLoading}
                    >
                      <Languages className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Traducir
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                      onClick={() => setCreateTaskOpen(true)}
                    >
                      <ListTodo className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Crear tarea
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>

            {detailAiPanel && (
              <div className="px-3 sm:px-6 py-3 border-b border-border/50 shrink-0">
                <div className="rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                      {detailAiPanel === "summarize" ? "Resumen" : "Traducción"}
                    </span>
                    <Button type="button" variant="outline" size="sm" onClick={closeDetailAiPanel}>
                      Cerrar
                    </Button>
                  </div>
                  {detailAiLoading ? (
                    <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 py-2">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      <span>
                        {detailAiPanel === "summarize" ? "Resumiendo…" : "Traduciendo…"}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                      {detailAiText || "Sin resultado."}
                    </p>
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

            {/* Email body + thread — columna centrada estilo lector premium */}
            <ScrollArea className="flex-1">
              <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-5">
                <div className="max-w-[min(100%,680px)] mx-auto w-full rounded-2xl border-2 border-primary/15 bg-card/95 shadow-md ring-1 ring-black/[0.06] dark:ring-white/[0.08] overflow-hidden">
                  <div className="px-4 py-5 sm:px-7 sm:py-7 bg-muted/20">
                    {emailDetail.body?.contentType === "html" ? (
                      <AutoResizeIframe
                        html={resolvedEmailHtml}
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

                {otherThreadEmails.length > 0 && (
                  <div className="max-w-[min(100%,680px)] mx-auto w-full border-t border-border/50 pt-5">
                    <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                      {otherThreadEmails.length} mensaje{otherThreadEmails.length > 1 ? "s" : ""} anterior{otherThreadEmails.length > 1 ? "es" : ""}
                    </p>
                    <div className="space-y-1.5">
                      {otherThreadEmails.map((threadEmail: any) => (
                        <ThreadEmailItem
                          key={threadEmail.id}
                          email={threadEmail}
                          onPreviewAttachment={setAttachmentPreview}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

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
        receivedDate={emailDetail?.receivedDateTime ? formatDistanceToNow(parseISO(emailDetail.receivedDateTime), { addSuffix: true, locale: es }) : undefined}
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
          replyAttachments={replyAttachments}
          showFullAI={showFullAI}
          setShowFullAI={setShowFullAI}
          createReplyDraftPending={createReplyDraft.isPending}
          createForwardDraftPending={createForwardDraft.isPending}
          isSending={isSending}
          isScheduling={scheduleSubmitting}
          onCancel={resetAction}
          onSend={handleSendReply}
          onScheduleMail={handleScheduleMail}
          onAttachmentPick={(files) => void handleReplyAttachmentPick(files)}
          onRemoveAttachment={removeReplyAttachment}
        />
      )}
      <ComposeEmailDialog open={composeOpen} onOpenChange={setComposeOpen} />
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
}: {
  email: any;
  onPreviewAttachment: (p: AttachmentPreviewState) => void;
}) {
  const [open, setOpen] = useState(false);
  const senderName = email.from?.emailAddress?.name || email.from?.emailAddress?.address;
  const senderEmail = email.from?.emailAddress?.address || "";
  const { data: threadAttachments = [] } = useEmailAttachments(open ? email.id : undefined);
  const { html: resolvedThreadHtml, loading: threadBodyLoading } = useResolvedEmailHtml(
    open ? email.id : undefined,
    email.body?.contentType === "html" ? email.body.content : undefined,
    threadAttachments,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-lg transition-colors text-left">
          <div className={cn("h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0", getAvatarColor(senderEmail))}>
            {getInitials(senderName, senderEmail)}
          </div>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
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
                html={resolvedThreadHtml}
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

/** Tema oscuro según clase `dark` en &lt;html&gt; (shadcn sin ThemeProvider). */
function useDocumentDarkClass(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
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
        sandbox="allow-same-origin"
        className="w-full border-0 bg-transparent rounded-md"
        style={{ height: `${height}px` }}
        title={title}
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
