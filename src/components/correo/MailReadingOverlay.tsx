import { cn } from "@/lib/utils";
import { ArrowLeft, Reply, Forward, Archive, Trash2, CheckSquare, Filter, Tag, FolderInput, ChevronRight, MessageSquare, CalendarPlus } from "lucide-react";
import { useEmailDetail, useArchiveEmail, useDeleteEmail, useMoveEmail, useMailFolders } from "@/hooks/useMicrosoft";
import { useResolvedEmailHtml } from "@/hooks/useResolvedEmailHtml";
import { useEmailAttachments } from "@/hooks/useMicrosoft";
import { MailLabelPicker } from "./MailLabelPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface EmailShape {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  importance?: string;
}

interface Props {
  emailId: string | null;
  open: boolean;
  onClose: () => void;
  onCompose: () => void;
  onForward?: () => void;
  onCreateTask: (email: EmailShape) => void;
  onCreateRule?: () => void;
  onSendToSlack?: () => void;
  onCreateEvent?: () => void;
}

export function MailReadingOverlay({ emailId, open, onClose, onCompose, onForward, onCreateTask, onCreateRule, onSendToSlack, onCreateEvent }: Props) {
  const { data: emailDetail, isLoading } = useEmailDetail(emailId);
  const { data: attachments = [] } = useEmailAttachments(emailId ?? undefined);
  const { html: resolvedHtml } = useResolvedEmailHtml(
    emailId ?? undefined,
    (emailDetail as any)?.body?.contentType === "html" ? (emailDetail as any)?.body?.content : undefined,
    attachments as any[],
  );
  const archiveEmail = useArchiveEmail();
  const deleteEmail = useDeleteEmail();
  const moveEmail = useMoveEmail();
  const { data: foldersData } = useMailFolders();
  const [moveFolderOpen, setMoveFolderOpen] = useState(false);

  const folders = useMemo(() => {
    const all = (foldersData?.folders ?? []) as { id: string; displayName: string; wellKnownFolderName?: string }[];
    return all;
  }, [foldersData]);

  const iframeSrc = useMemo(() => {
    if (!resolvedHtml && !(emailDetail as any)?.body?.content) return "";
    return resolvedHtml || (emailDetail as any)?.body?.content || "";
  }, [resolvedHtml, emailDetail]);

  const senderName = (emailDetail as any)?.from?.emailAddress?.name || (emailDetail as any)?.from?.emailAddress?.address || "";
  const senderEmail = (emailDetail as any)?.from?.emailAddress?.address || "";
  const receivedAt = (emailDetail as any)?.receivedDateTime
    ? format(new Date((emailDetail as any).receivedDateTime), "d 'de' MMMM, yyyy HH:mm", { locale: es })
    : "";

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col bg-card border-l border-border/30 transition-transform duration-200 ease-out overflow-hidden",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Nav bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Lista
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            className="h-[30px] flex items-center gap-1.5 px-2.5 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors"
            onClick={onCompose}
          >
            <Reply className="w-3.5 h-3.5" />
            Responder
          </button>
          {onForward && (
            <button
              className="h-[30px] flex items-center gap-1.5 px-2.5 rounded-md border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
              onClick={onForward}
              title="Reenviar"
            >
              <Forward className="w-3.5 h-3.5" />
              Reenviar
            </button>
          )}
          <div className="w-px h-4 bg-border mx-1" />

          {/* Move to folder */}
          <Popover open={moveFolderOpen} onOpenChange={setMoveFolderOpen}>
            <PopoverTrigger asChild>
              <button
                className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Mover a carpeta"
              >
                <FolderInput className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-[220px] p-1.5">
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground px-2 pb-1.5">
                Mover a carpeta
              </p>
              <div className="max-h-[260px] overflow-y-auto space-y-0.5">
                {folders.length === 0 && (
                  <p className="text-[12px] text-muted-foreground/60 px-2 py-1.5">Sin carpetas</p>
                )}
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => {
                      if (!emailId) return;
                      moveEmail.mutate({ messageId: emailId, destinationId: folder.id });
                      setMoveFolderOpen(false);
                      onClose();
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-[12.5px] text-left transition-colors"
                  >
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{folder.displayName}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <button
            className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Crear regla"
            onClick={onCreateRule}
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
          <MailLabelPicker emailMessageId={emailId || ""}>
            <button
              className="h-[30px] flex items-center gap-1.5 px-2.5 rounded-md border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Etiquetas"
            >
              <Tag className="w-3.5 h-3.5" />
              Etiqueta
            </button>
          </MailLabelPicker>
          <button
            className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Archivar"
            onClick={() => { if (emailId) { archiveEmail.mutate(emailId); onClose(); } }}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
          <button
            className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Eliminar"
            onClick={() => { if (emailId) { deleteEmail.mutate(emailId); onClose(); } }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Crear tarea"
            onClick={() => emailDetail && onCreateTask(emailDetail as EmailShape)}
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Crear evento en calendario"
            onClick={onCreateEvent}
          >
            <CalendarPlus className="w-3.5 h-3.5" />
          </button>
          <button
            className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Enviar a Slack"
            onClick={onSendToSlack}
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Email body */}
      <div className="flex-1 overflow-y-auto min-h-0 px-8 py-7 max-w-3xl w-full">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-8 bg-muted/50 rounded w-3/4" />
            <div className="h-4 bg-muted/30 rounded w-1/2" />
          </div>
        ) : emailDetail ? (
          <>
            <h1 className="text-[22px] font-bold tracking-tight text-foreground leading-tight mb-4">
              {(emailDetail as any).subject || "(sin asunto)"}
            </h1>
            <div className="flex items-start gap-3 mb-6">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                style={{ background: "hsl(217 91% 55%)" }}
              >
                {senderName.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground">{senderName}</p>
                <p className="text-[11.5px] text-muted-foreground">{senderEmail}</p>
              </div>
              <p className="text-[11.5px] text-muted-foreground shrink-0">{receivedAt}</p>
            </div>
            {iframeSrc ? (
              <iframe
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.7;color:#374151;margin:0;padding:0}a{color:#2563eb;cursor:pointer}img{max-width:100%}</style></head><body>${iframeSrc}</body></html>`}
                className="w-full border-0 min-h-[400px]"
                style={{ height: "auto" }}
                onLoad={(e) => {
                  const iframe = e.currentTarget;
                  try {
                    const doc = iframe.contentDocument;
                    if (doc) {
                      doc.querySelectorAll("a").forEach((a) => {
                        a.setAttribute("target", "_blank");
                        a.setAttribute("rel", "noopener noreferrer");
                      });
                      iframe.style.height = doc.body.scrollHeight + "px";
                    }
                  } catch {}
                }}
              />
            ) : (
              <p className="text-[14px] text-muted-foreground whitespace-pre-wrap">
                {(emailDetail as any).bodyPreview}
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
