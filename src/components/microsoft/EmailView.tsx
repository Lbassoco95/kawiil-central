import { useState, useCallback, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useOutlookEmails,
  useEmailDetail,
  useReplyEmail,
  useForwardEmail,
  useMarkEmailRead,
  useMailFolders,
  useEmailConversation,
  useCreateReplyDraft,
  useSendDraft,
  useCreateMailFolder,
  useMoveEmail,
  useDeleteEmail,
  useEmailAttachments,
} from "@/hooks/useMicrosoft";
import {
  Search, Mail, MailOpen, Paperclip, Loader2, Reply, ReplyAll, Forward, Send,
  ClipboardList, Sparkles, Languages, ListChecks, Inbox, SendHorizonal,
  FileText, Trash2, AlertCircle, FolderOpen, ChevronDown, ChevronRight,
  FolderPlus, X, Check, FolderInput,
} from "lucide-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { es } from "date-fns/locale";
import { CreateTaskFromEmailDialog } from "./CreateTaskFromEmailDialog";
import { EmailAIAssistant } from "./EmailAIAssistant";
import { RichTextEditor } from "./RichTextEditor";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { cn } from "@/lib/utils";

type EmailAction = "reply" | "reply-all" | "forward" | null;

const FOLDER_ICONS: Record<string, any> = {
  inbox: Inbox,
  sentitems: SendHorizonal,
  drafts: FileText,
  deleteditems: Trash2,
  junkemail: AlertCircle,
};

const FOLDER_LABELS: Record<string, string> = {
  inbox: "Bandeja de entrada",
  sentitems: "Enviados",
  drafts: "Borradores",
  deleteditems: "Eliminados",
  junkemail: "Spam",
};

function getFolderIcon(displayName: string) {
  const key = displayName.toLowerCase().replace(/\s/g, "");
  // Map well-known folder display names
  if (key.includes("inbox") || key.includes("bandeja")) return Inbox;
  if (key.includes("sent") || key.includes("enviado")) return SendHorizonal;
  if (key.includes("draft") || key.includes("borrador")) return FileText;
  if (key.includes("deleted") || key.includes("eliminad")) return Trash2;
  if (key.includes("junk") || key.includes("spam") || key.includes("correo no deseado")) return AlertCircle;
  return FolderOpen;
}

function getFolderLabel(displayName: string) {
  const key = displayName.toLowerCase().replace(/\s/g, "");
  if (key.includes("inbox") || key.includes("bandejadeentrada")) return "Bandeja de entrada";
  if (key.includes("sentitems") || key.includes("elementosenviados")) return "Enviados";
  if (key.includes("drafts") || key.includes("borradores")) return "Borradores";
  if (key.includes("deleteditems") || key.includes("elementoseliminados")) return "Eliminados";
  if (key.includes("junkemail") || key.includes("correonodeseado")) return "Spam";
  return displayName;
}

const WELL_KNOWN_ORDER = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail"];

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
  const listRef = useRef<HTMLDivElement>(null);

  const { data: folders = [] } = useMailFolders();
  const { data: emails = [], isLoading } = useOutlookEmails(selectedFolderId, debouncedSearch || undefined);
  const { data: emailDetail, isLoading: detailLoading } = useEmailDetail(selectedEmailId);
  const { data: threadEmails = [] } = useEmailConversation(emailDetail?.conversationId || null);
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();
  const markRead = useMarkEmailRead();
  const createReplyDraft = useCreateReplyDraft();
  const sendDraft = useSendDraft();
  const createMailFolder = useCreateMailFolder();
  const moveEmail = useMoveEmail();
  const deleteEmail = useDeleteEmail();
  const { data: attachments = [] } = useEmailAttachments(
    emailDetail?.hasAttachments ? selectedEmailId ?? undefined : undefined
  );

  const sortedFolders = sortFolders(folders);

  const handleMoveEmail = useCallback((messageId: string, destinationId: string) => {
    moveEmail.mutate({ messageId, destinationId }, {
      onSuccess: () => {
        if (selectedEmailId === messageId) {
          const idx = emails.findIndex((e: any) => e.id === messageId);
          const next = emails[idx + 1] || emails[idx - 1];
          setSelectedEmailId(next?.id || null);
          resetAction();
        }
        setMovePopoverOpen(false);
      },
    });
  }, [moveEmail, selectedEmailId, emails]);

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
    } catch {
      // Fallback: just open textarea
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmailId) return;

    if (emailAction === "forward") {
      if (!forwardTo.trim()) return;
      forwardEmail.mutate(
        {
          messageId: selectedEmailId,
          comment: stripTags(draftHtml),
          toRecipients: forwardTo.split(",").map((s) => s.trim()),
        },
        { onSuccess: resetAction }
      );
      return;
    }

    if (draftId) {
      sendDraft.mutate(
        {
          draftId,
          body: { contentType: "HTML", content: draftHtml },
        },
        { onSuccess: resetAction }
      );
    } else {
      // Fallback to simple reply
      replyEmail.mutate(
        {
          messageId: selectedEmailId,
          comment: stripTags(draftHtml),
          replyAll: emailAction === "reply-all",
        },
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

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!emails.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const currentIdx = emails.findIndex((em: any) => em.id === selectedEmailId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, emails.length - 1);
        handleOpenEmail(emails[next]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        handleOpenEmail(emails[prev]);
      } else if (e.key === "r" && !emailAction) {
        e.preventDefault();
        handleStartReply("reply");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [emails, selectedEmailId, handleOpenEmail, emailAction]);

  const isSending = replyEmail.isPending || forwardEmail.isPending || sendDraft.isPending;

  // Thread emails excluding the current one
  const otherThreadEmails = threadEmails.filter((e: any) => e.id !== selectedEmailId);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full border-t border-border overflow-hidden bg-background">
      {/* Panel 1: Folders */}
      <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="bg-muted/20">
        <div className="flex flex-col h-full">
          <ScrollArea className="flex-1">
            <div className="py-2">
              {sortedFolders.map((folder: any) => {
                const Icon = getFolderIcon(folder.displayName);
                const label = getFolderLabel(folder.displayName);
                const isActive = selectedFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent/50 text-left",
                      isActive && "bg-accent text-accent-foreground font-medium",
                      dragOverFolderId === folder.id && "bg-primary/20 ring-1 ring-primary"
                    )}
                    onClick={() => {
                      setSelectedFolderId(folder.id);
                      setSelectedEmailId(null);
                      resetAction();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverFolderId(folder.id);
                    }}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverFolderId(null);
                      const messageId = e.dataTransfer.getData("text/email-id");
                      if (messageId && folder.id !== selectedFolderId) {
                        handleMoveEmail(messageId, folder.id);
                      }
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{label}</span>
                    {folder.unreadItemCount > 0 && (
                      <Badge variant="destructive" className="h-4 px-1.5 text-[10px] font-semibold">
                        {folder.unreadItemCount}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
          {/* Create folder */}
          <div className="shrink-0 border-t border-border p-2">
            {creatingFolder ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  placeholder="Nombre..."
                  className="h-7 text-xs flex-1"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      createMailFolder.mutate(newFolderName.trim(), {
                        onSuccess: () => { setCreatingFolder(false); setNewFolderName(""); },
                      });
                    }
                    if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                  }}
                />
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => {
                    if (newFolderName.trim()) {
                      createMailFolder.mutate(newFolderName.trim(), {
                        onSuccess: () => { setCreatingFolder(false); setNewFolderName(""); },
                      });
                    }
                  }}
                  disabled={createMailFolder.isPending}
                >
                  {createMailFolder.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost" size="sm" className="w-full h-7 text-xs justify-start gap-2"
                onClick={() => setCreatingFolder(true)}
              >
                <FolderPlus className="h-3.5 w-3.5" /> Nueva carpeta
              </Button>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Panel 2: Email list */}
      <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
        <div className="flex flex-col h-full">
          <div className="p-2 border-b border-border space-y-1.5">
            <Button size="sm" className="w-full h-8 text-xs" onClick={() => setComposeOpen(true)}>
              <Send className="mr-1.5 h-3.5 w-3.5" /> Redactar correo
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar correos..."
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
          </div>

          <ScrollArea className="flex-1" ref={listRef}>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : emails.length === 0 ? (
              <div className="p-6 text-center">
                <Mail className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground">Sin correos</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {emails.map((email: any) => (
                  <div
                    key={email.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/email-id", email.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={cn(
                      "px-3 py-2 cursor-pointer transition-colors hover:bg-accent/50",
                      selectedEmailId === email.id && "bg-accent",
                      !email.isRead && "bg-primary/5"
                    )}
                    onClick={() => handleOpenEmail(email)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="pt-0.5 shrink-0">
                        {email.isRead ? (
                          <MailOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Mail className="h-3.5 w-3.5 text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={cn("text-xs truncate", !email.isRead ? "font-semibold text-foreground" : "text-foreground")}>
                            {email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Desconocido"}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(parseISO(email.receivedDateTime), { addSuffix: false, locale: es })}
                          </span>
                        </div>
                        <p className={cn("text-xs truncate", !email.isRead ? "font-medium text-foreground" : "text-muted-foreground")}>
                          {email.subject || "(sin asunto)"}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                          {email.bodyPreview?.substring(0, 80)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        {email.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                        {email.importance === "high" && <div className="h-2 w-2 rounded-full bg-destructive" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Panel 3: Detail */}
      <ResizablePanel defaultSize={55} minSize={30}>
        <div className="flex flex-col h-full min-w-0">
          {!selectedEmailId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Mail className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Selecciona un correo para leerlo</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Usa ↑↓ o j/k para navegar · r para responder</p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : emailDetail ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-border shrink-0">
                <h2 className="text-base font-semibold text-foreground leading-tight mb-2">
                  {emailDetail.subject || "(sin asunto)"}
                </h2>
                <div className="flex items-start justify-between gap-4">
                  <div className="text-xs text-muted-foreground space-y-0.5 min-w-0">
                    <p className="truncate">
                      <span className="font-medium text-foreground">{emailDetail.from?.emailAddress?.name}</span>{" "}
                      &lt;{emailDetail.from?.emailAddress?.address}&gt;
                    </p>
                    <p className="truncate">
                      Para: {emailDetail.toRecipients?.map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", ")}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {emailDetail.receivedDateTime
                      ? format(parseISO(emailDetail.receivedDateTime), "d MMM yyyy, HH:mm", { locale: es })
                      : ""}
                  </span>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border shrink-0 flex-wrap">
                <Button
                  variant={emailAction === "reply" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => emailAction === "reply" ? resetAction() : handleStartReply("reply")}
                >
                  <Reply className="mr-1 h-3 w-3" /> Responder
                </Button>
                <Button
                  variant={emailAction === "reply-all" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => emailAction === "reply-all" ? resetAction() : handleStartReply("reply-all")}
                >
                  <ReplyAll className="mr-1 h-3 w-3" /> Todos
                </Button>
                <Button
                  variant={emailAction === "forward" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => emailAction === "forward" ? resetAction() : handleStartReply("forward")}
                >
                  <Forward className="mr-1 h-3 w-3" /> Reenviar
                </Button>

                <Popover open={movePopoverOpen} onOpenChange={setMovePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <FolderInput className="mr-1 h-3 w-3" /> Mover a
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="start">
                    <ScrollArea className="max-h-64">
                      {sortedFolders
                        .filter((f: any) => f.id !== selectedFolderId)
                        .map((folder: any) => {
                          const Icon = getFolderIcon(folder.displayName);
                          const label = getFolderLabel(folder.displayName);
                          return (
                            <button
                              key={folder.id}
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent rounded-sm text-left"
                              onClick={() => {
                                if (selectedEmailId) handleMoveEmail(selectedEmailId, folder.id);
                              }}
                            >
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="truncate">{label}</span>
                            </button>
                          );
                        })}
                    </ScrollArea>
                  </PopoverContent>
                </Popover>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (selectedEmailId && confirm("¿Eliminar este correo?")) {
                      const id = selectedEmailId;
                      const idx = emails.findIndex((e: any) => e.id === id);
                      const next = emails[idx + 1] || emails[idx - 1];
                      setSelectedEmailId(next?.id || null);
                      resetAction();
                      deleteEmail.mutate(id);
                    }
                  }}
                >
                  <Trash2 className="mr-1 h-3 w-3" /> Eliminar
                </Button>

                <div className="w-px h-5 bg-border mx-1" />

                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setQuickAIPrompt("Resume los puntos clave de este correo en viñetas.")}
                >
                  <ListChecks className="mr-1 h-3 w-3" /> Resumir
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setQuickAIPrompt("Traduce este correo al inglés manteniendo el tono profesional.")}
                >
                  <Languages className="mr-1 h-3 w-3" /> Traducir
                </Button>

                <div className="ml-auto">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCreateTaskOpen(true)}>
                    <ClipboardList className="mr-1 h-3 w-3" /> Tarea
                  </Button>
                </div>
              </div>

              {/* Quick AI result */}
              {quickAIPrompt && (
                <div className="px-4 py-2 border-b border-border shrink-0">
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
                <div className="p-4 space-y-4">
                  {/* Current email */}
                  {emailDetail.body?.contentType === "html" ? (
                    <AutoResizeIframe html={emailDetail.body.content} title="Email content" />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm p-2">{emailDetail.body?.content}</pre>
                  )}

                  {attachments.length > 0 && (
                    <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Paperclip className="h-3.5 w-3.5" /> {attachments.length} adjunto{attachments.length > 1 ? "s" : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((att: any) => (
                          <button
                            key={att.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-background hover:bg-secondary/40 text-xs transition-colors"
                            onClick={() => {
                              if (att.contentBytes) {
                                const byteChars = atob(att.contentBytes);
                                const byteNums = new Array(byteChars.length);
                                for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                                const blob = new Blob([new Uint8Array(byteNums)], { type: att.contentType });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = att.name;
                                a.click();
                                URL.revokeObjectURL(url);
                              }
                            }}
                          >
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[140px]">{att.name}</span>
                            <span className="text-muted-foreground">
                              {att.size > 1024 * 1024
                                ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
                                : `${Math.round(att.size / 1024)} KB`}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Thread / previous emails */}
                  {otherThreadEmails.length > 0 && (
                    <div className="border-t border-border pt-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        {otherThreadEmails.length} mensaje{otherThreadEmails.length > 1 ? "s" : ""} anterior{otherThreadEmails.length > 1 ? "es" : ""}
                      </p>
                      <div className="space-y-1">
                        {otherThreadEmails.map((threadEmail: any) => (
                          <ThreadEmailItem key={threadEmail.id} email={threadEmail} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Reply/Forward form with rich text */}
              {emailAction && (
                <div className="border-t border-border p-4 shrink-0 space-y-3 bg-muted/20 max-h-[45%] overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      {emailAction === "reply" ? "Responder" : emailAction === "reply-all" ? "Responder a todos" : "Reenviar"}
                    </Label>
                    <Button
                      variant={showFullAI ? "default" : "ghost"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowFullAI(!showFullAI)}
                    >
                      <Sparkles className="mr-1 h-3 w-3" /> Kawiil AI
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
                      className="text-sm h-8"
                    />
                  )}

                  {createReplyDraft.isPending ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
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

                  <div className="flex justify-between items-center">
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={resetAction}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleSendReply}
                      disabled={isSending || !draftHtml.trim()}
                    >
                      {isSending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                      {emailAction === "forward" ? "Reenviar" : "Enviar"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </ResizablePanel>

      {/* Create task dialog */}
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
    </ResizablePanelGroup>
  );
}

// Collapsible thread email item
function ThreadEmailItem({ email }: { email: any }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/50 rounded-md transition-colors text-left">
          {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className="font-medium text-foreground truncate">
            {email.from?.emailAddress?.name || email.from?.emailAddress?.address}
          </span>
          <span className="text-muted-foreground truncate flex-1">
            — {email.bodyPreview?.substring(0, 60)}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {email.receivedDateTime ? format(parseISO(email.receivedDateTime), "d MMM, HH:mm", { locale: es }) : ""}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 mr-2 mb-2 border border-border rounded-md overflow-hidden">
          {email.body?.contentType === "html" ? (
            <AutoResizeIframe html={email.body.content} title="Thread email" minH={100} />
          ) : (
            <pre className="whitespace-pre-wrap text-xs p-3 text-muted-foreground">{email.body?.content}</pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Auto-resize iframe for email content
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
      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#333;margin:0;padding:12px;word-wrap:break-word;line-height:1.5;overflow:hidden;}img{max-width:100%;height:auto;}a{color:hsl(221,83%,53%);}table{max-width:100%;border-collapse:collapse;}blockquote{border-left:3px solid #ddd;margin:8px 0;padding:4px 12px;color:#666;}</style></head><body>${html}</body></html>`}
      sandbox="allow-same-origin"
      className="w-full border-0 bg-background"
      style={{ height: `${height}px` }}
      title={title}
      onLoad={resizeIframe}
    />
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
