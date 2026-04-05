import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  useSendDraft,
  useCreateMailFolder,
  useMoveEmail,
  useDeleteEmail,
  useEmailAttachments,
  useUnreadEmailCount,
} from "@/hooks/useMicrosoft";
import {
  Search, Mail, MailOpen, Paperclip, Loader2, Reply, ReplyAll, Forward, Send,
  Sparkles, Languages, ListTodo, Inbox, SendHorizonal,
  FileText, Trash2, AlertCircle, FolderOpen, ChevronDown, ChevronRight,
  FolderPlus, X, Check, FolderInput, Archive, Star, MoreHorizontal,
  Keyboard, ArrowDown,
} from "lucide-react";
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
import { RichTextEditor } from "./RichTextEditor";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

type EmailAction = "reply" | "reply-all" | "forward" | null;

function getFolderIcon(displayName: string) {
  const key = displayName.toLowerCase().replace(/\s/g, "");
  if (key.includes("inbox") || key.includes("bandeja")) return Inbox;
  if (key.includes("sent") || key.includes("enviado")) return SendHorizonal;
  if (key.includes("draft") || key.includes("borrador")) return FileText;
  if (key.includes("deleted") || key.includes("eliminad")) return Trash2;
  if (key.includes("junk") || key.includes("spam") || key.includes("correo no deseado")) return AlertCircle;
  if (key.includes("archive") || key.includes("archiv")) return Archive;
  return FolderOpen;
}

function getFolderLabel(displayName: string) {
  const key = displayName.toLowerCase().replace(/\s/g, "");
  if (key.includes("inbox") || key.includes("bandejadeentrada")) return "Bandeja de entrada";
  if (key.includes("sentitems") || key.includes("elementosenviados")) return "Enviados";
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

export function EmailView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailAction, setEmailAction] = useState<EmailAction>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showFullAI, setShowFullAI] = useState(false);
  const [quickAIPrompt, setQuickAIPrompt] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftHtml, setDraftHtml] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const { data: folders = [] } = useMailFolders();
  const { data: inboxUnread = 0 } = useUnreadEmailCount();
  const emailsQuery = useOutlookEmails(selectedFolderId, debouncedSearch || undefined);
  const { data: emailDetail, isLoading: detailLoading } = useEmailDetail(selectedEmailId);
  const { data: threadEmails = [] } = useEmailConversation(emailDetail?.conversationId || null);
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();
  const markRead = useMarkEmailRead();
  const markUnread = useMarkEmailUnread();
  const archiveEmail = useArchiveEmail();
  const createReplyDraft = useCreateReplyDraft();
  const sendDraft = useSendDraft();
  const createMailFolder = useCreateMailFolder();
  const moveEmail = useMoveEmail();
  const deleteEmail = useDeleteEmail();
  const { data: attachments = [] } = useEmailAttachments(
    emailDetail?.hasAttachments ? selectedEmailId ?? undefined : undefined
  );

  const allEmails = useMemo(() => {
    if (!emailsQuery.data?.pages) return [];
    return emailsQuery.data.pages.flatMap((p) => p.emails);
  }, [emailsQuery.data]);

  const isLoading = emailsQuery.isLoading;
  const hasNextPage = emailsQuery.hasNextPage;
  const isFetchingNextPage = emailsQuery.isFetchingNextPage;

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
    if (action === "forward") return;
    try {
      const draft = await createReplyDraft.mutateAsync({
        messageId: selectedEmailId,
        replyAll: action === "reply-all",
      });
      if (draft?.id) {
        setDraftId(draft.id);
        setDraftHtml(draft.body?.content || "");
      }
    } catch { /* fallback */ }
  };

  const handleSendReply = async () => {
    if (!selectedEmailId) return;
    if (emailAction === "forward") {
      if (!forwardTo.trim()) return;
      forwardEmail.mutate(
        { messageId: selectedEmailId, comment: stripTags(draftHtml), toRecipients: forwardTo.split(",").map((s) => s.trim()) },
        { onSuccess: resetAction }
      );
      return;
    }
    if (draftId) {
      sendDraft.mutate(
        { draftId, body: { contentType: "HTML", content: draftHtml } },
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
  };

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

  // Keyboard navigation (Superhuman style)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!allEmails.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

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
  }, [allEmails, selectedEmailId, handleOpenEmail, emailAction, handleArchive, handleDelete]);

  const isSending = replyEmail.isPending || forwardEmail.isPending || sendDraft.isPending;
  const otherThreadEmails = threadEmails.filter((e: any) => e.id !== selectedEmailId);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Folder sidebar — collapsible on mobile */}
      <div className={cn(
        "shrink-0 border-r border-border bg-muted/30 flex flex-col transition-all duration-200",
        isMobile ? (showFolders ? "w-56 absolute z-30 h-full shadow-xl" : "w-0 overflow-hidden") : "w-52"
      )}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Carpetas</span>
          {isMobile && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowFolders(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1">
            {sortedFolders.map((folder: any) => {
              const Icon = getFolderIcon(folder.displayName);
              const label = getFolderLabel(folder.displayName);
              const isActive = selectedFolderId === folder.id;
              const folderBadge = getFolderSidebarBadge(folder, inboxUnread);
              return (
                <button
                  key={folder.id}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-all hover:bg-accent/60 text-left rounded-none",
                    isActive && "bg-accent text-accent-foreground font-medium border-l-2 border-primary",
                    dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary"
                  )}
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    setSelectedEmailId(null);
                    resetAction();
                    if (isMobile) setShowFolders(false);
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverFolderId(folder.id); }}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolderId(null);
                    const messageId = e.dataTransfer.getData("text/email-id");
                    if (messageId && folder.id !== selectedFolderId) handleMoveEmail(messageId, folder.id);
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 text-sm">{label}</span>
                  {folderBadge != null && folderBadge > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold bg-primary/15 text-primary">
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
      </div>

      {/* Email list panel */}
      <div className={cn("flex flex-col border-r border-border bg-background transition-all duration-200",
        isMobile ? "flex-1" : "w-[320px] lg:w-[380px] shrink-0",
        selectedEmailId && isMobile && "hidden"
      )}>
        {/* Search & compose toolbar */}
        <div className="p-3 border-b border-border/50 space-y-2">
          <div className="flex items-center gap-2">
            {isMobile && (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowFolders(true)}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            )}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar correos..."
                className="pl-9 h-9 text-sm bg-muted/40 border-0 focus-visible:ring-1"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <Button size="sm" className="h-9 px-4 gap-2 shrink-0" onClick={() => setComposeOpen(true)}>
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Redactar</span>
            </Button>
          </div>
        </div>

        {/* Email list */}
        <ScrollArea className="flex-1" ref={listRef}>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-10 w-10 rounded-full bg-secondary/40 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 bg-secondary/40 rounded w-3/4" />
                    <div className="h-3 bg-secondary/30 rounded w-full" />
                    <div className="h-2.5 bg-secondary/20 rounded w-2/3" />
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
            <div>
              {allEmails.map((email: any) => {
                const isActive = selectedEmailId === email.id;
                const senderName = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Desconocido";
                const senderEmail = email.from?.emailAddress?.address || "";
                return (
                  <div
                    key={email.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/email-id", email.id); e.dataTransfer.effectAllowed = "move"; }}
                    className={cn(
                      "group flex flex-col px-3 py-2.5 cursor-pointer transition-colors border-b border-border/30",
                      !email.isRead && !isActive && "bg-blue-50/40 dark:bg-blue-950/20",
                      isActive && "bg-accent border-l-2 border-l-primary",
                      !isActive && "hover:bg-accent/40",
                    )}
                    onClick={() => handleOpenEmail(email)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0 mt-4",
                          !email.isRead ? "bg-blue-500" : "bg-transparent",
                        )}
                        aria-hidden
                      />
                      <div
                        className={cn(
                          "h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5",
                          getAvatarColor(senderEmail),
                        )}
                      >
                        {getInitials(senderName, senderEmail)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span
                            className={cn(
                              "truncate font-semibold text-sm",
                              !email.isRead ? "text-foreground" : "text-foreground/80",
                            )}
                          >
                            {senderName}
                          </span>
                          <span className="text-xs text-muted-foreground font-normal whitespace-nowrap ml-2 shrink-0">
                            {formatEmailDate(emailListTimestamp(email))}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "text-sm truncate leading-snug",
                            !email.isRead ? "font-semibold text-foreground" : "font-normal text-muted-foreground",
                          )}
                        >
                          {email.subject || "(sin asunto)"}
                        </p>
                        <p
                          className={cn(
                            "text-xs truncate mt-0.5 leading-relaxed",
                            !email.isRead ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {email.bodyPreview?.substring(0, 100)}
                        </p>
                      </div>

                      <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
                        {email.hasAttachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground/50" />}
                        {email.importance === "high" && <div className="h-2 w-2 rounded-full bg-destructive" />}
                      </div>
                    </div>

                    {/* Quick actions — always visible on mobile, hover on desktop */}
                    <div className={cn(
                      "items-center gap-1 mt-1.5 ml-14",
                      isMobile ? "flex" : "hidden group-hover:flex"
                    )}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="p-1.5 sm:p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleArchive(email.id); }}
                          >
                            <Archive className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Archivar (e)</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="p-1.5 sm:p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleDelete(email.id); }}
                          >
                            <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Eliminar (#)</TooltipContent>
                      </Tooltip>
                      {email.isRead ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="p-1.5 sm:p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                              onClick={(e) => { e.stopPropagation(); markUnread.mutate(email.id); }}
                            >
                              <Mail className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Marcar no leído (u)</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* Load more button */}
              {hasNextPage && (
                <div className="p-4 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => emailsQuery.fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5" />
                    )}
                    {isFetchingNextPage ? "Cargando..." : "Cargar más correos"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Detail panel */}
      <div className={cn(
        "flex-1 flex flex-col min-w-0 bg-background",
        !selectedEmailId && isMobile && "hidden"
      )}>
        {!selectedEmailId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-muted/40 mb-4">
                <Mail className="h-9 w-9 text-muted-foreground/30" />
              </div>
              <p className="text-base font-medium text-muted-foreground mb-2">Selecciona un correo</p>
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/50">
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">j</kbd><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">k</kbd> navegar</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">r</kbd> responder</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">e</kbd> archivar</span>
              </div>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : emailDetail ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Detail header */}
            <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border/50 shrink-0">
              {isMobile && (
                <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-xs" onClick={() => setSelectedEmailId(null)}>
                  <ChevronRight className="h-3.5 w-3.5 mr-1 rotate-180" /> Volver
                </Button>
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
                    Para: {emailDetail.toRecipients?.map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", ")}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 pt-1">
                  {emailDetail.receivedDateTime
                    ? format(parseISO(emailDetail.receivedDateTime), "d MMM yyyy, HH:mm", { locale: es })
                    : ""}
                </span>
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
                      onClick={() =>
                        setQuickAIPrompt("Resume los puntos clave de este correo en viñetas.")
                      }
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
                      onClick={() =>
                        setQuickAIPrompt(
                          "Traduce este correo al inglés manteniendo el tono profesional.",
                        )
                      }
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

            {/* Quick AI result */}
            {quickAIPrompt && (
              <div className="px-3 sm:px-6 py-3 border-b border-border/50 shrink-0 bg-primary/[0.03]">
                <EmailAIAssistant
                  mode="quick"
                  emailSubject={emailDetail.subject || ""}
                  emailBody={emailDetail.body?.content || ""}
                  senderName={emailDetail.from?.emailAddress?.name}
                  autoPrompt={quickAIPrompt}
                  onClose={() => setQuickAIPrompt(null)}
                />
              </div>
            )}

            {/* Email body + thread */}
            <ScrollArea className="flex-1">
              <div className="px-3 sm:px-6 py-4 sm:py-5 space-y-5">
                {emailDetail.body?.contentType === "html" ? (
                  <AutoResizeIframe html={emailDetail.body.content} title="Email content" />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm p-2 leading-relaxed">{emailDetail.body?.content}</pre>
                )}

                {attachments.length > 0 && (
                  <div className="rounded-xl border border-border/50 p-4 space-y-2.5 bg-muted/20">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5" /> {attachments.length} adjunto{attachments.length > 1 ? "s" : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((att: any) => (
                        <button
                          key={att.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-background hover:bg-secondary/40 text-sm transition-all hover:shadow-sm"
                          onClick={() => {
                            if (att.contentBytes) {
                              const byteChars = atob(att.contentBytes);
                              const byteNums = new Array(byteChars.length);
                              for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                              const blob = new Blob([new Uint8Array(byteNums)], { type: att.contentType });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url; a.download = att.name; a.click();
                              URL.revokeObjectURL(url);
                            }
                          }}
                        >
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[180px]">{att.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {att.size > 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(att.size / 1024)} KB`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {otherThreadEmails.length > 0 && (
                  <div className="border-t border-border/50 pt-5">
                    <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                      {otherThreadEmails.length} mensaje{otherThreadEmails.length > 1 ? "s" : ""} anterior{otherThreadEmails.length > 1 ? "es" : ""}
                    </p>
                    <div className="space-y-1.5">
                      {otherThreadEmails.map((threadEmail: any) => (
                        <ThreadEmailItem key={threadEmail.id} email={threadEmail} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Reply/Forward form */}
            {emailAction && (
              <div className="border-t border-border p-3 sm:p-5 shrink-0 space-y-3 bg-muted/20 max-h-[45%] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">
                    {emailAction === "reply" ? "Responder" : emailAction === "reply-all" ? "Responder a todos" : "Reenviar"}
                  </Label>
                  <Button variant={showFullAI ? "default" : "ghost"} size="sm" className="h-8 text-xs gap-1.5"
                    onClick={() => setShowFullAI(!showFullAI)}>
                    <Sparkles className="h-3.5 w-3.5" /> Kawiil AI
                  </Button>
                </div>

                {showFullAI && (
                  <EmailAIAssistant
                    mode="full"
                    emailSubject={emailDetail.subject || ""}
                    emailBody={emailDetail.body?.content || ""}
                    senderName={emailDetail.from?.emailAddress?.name}
                    onInsertText={(text) => setDraftHtml((prev) => `<p>${text.replace(/\n/g, "<br>")}</p>${prev}`)}
                    onClose={() => setShowFullAI(false)}
                  />
                )}

                {emailAction === "forward" && (
                  <Input
                    placeholder="Para (separar con coma): correo@ejemplo.com"
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                    className="text-sm h-9"
                  />
                )}

                {createReplyDraft.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> Preparando respuesta con firma...
                  </div>
                ) : (
                  <RichTextEditor
                    key={draftId || "new"}
                    initialHtml={draftHtml}
                    placeholder={emailAction === "forward" ? "Mensaje al reenviar..." : "Escribe tu respuesta..."}
                    onHtmlChange={setDraftHtml}
                  />
                )}

                <div className="flex justify-between items-center pt-1">
                  <Button variant="ghost" size="sm" className="text-sm h-8" onClick={resetAction}>Cancelar</Button>
                  <Button size="sm" className="h-8 text-sm gap-1.5" onClick={handleSendReply} disabled={isSending || !draftHtml.trim()}>
                    {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {emailAction === "forward" ? "Reenviar" : "Enviar"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <CreateTaskFromEmailDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        emailSubject={emailDetail?.subject}
        senderName={emailDetail?.from?.emailAddress?.name}
        senderEmail={emailDetail?.from?.emailAddress?.address}
        bodyPreview={emailDetail?.bodyPreview}
        receivedDate={emailDetail?.receivedDateTime ? formatDistanceToNow(parseISO(emailDetail.receivedDateTime), { addSuffix: true, locale: es }) : undefined}
      />
      <ComposeEmailDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}

function ThreadEmailItem({ email }: { email: any }) {
  const [open, setOpen] = useState(false);
  const senderName = email.from?.emailAddress?.name || email.from?.emailAddress?.address;
  const senderEmail = email.from?.emailAddress?.address || "";

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
        <div className="ml-10 mr-2 mb-2 border border-border/50 rounded-lg overflow-hidden">
          {email.body?.contentType === "html" ? (
            <AutoResizeIframe html={email.body.content} title="Thread email" minH={100} />
          ) : (
            <pre className="whitespace-pre-wrap text-sm p-3 text-muted-foreground">{email.body?.content}</pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AutoResizeIframe({ html, title, minH = 200 }: { html: string; title: string; minH?: number }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minH);

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

  return (
    <iframe
      ref={iframeRef}
      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#333;margin:0;padding:12px;word-wrap:break-word;line-height:1.6;overflow:hidden;}img{max-width:100%;height:auto;}a{color:hsl(221,83%,53%);}table{max-width:100%;border-collapse:collapse;}blockquote{border-left:3px solid #ddd;margin:8px 0;padding:4px 12px;color:#666;}</style></head><body>${html}</body></html>`}
      sandbox="allow-same-origin"
      className="w-full border-0 bg-background rounded-lg"
      style={{ height: `${height}px` }}
      title={title}
      onLoad={resizeIframe}
    />
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
