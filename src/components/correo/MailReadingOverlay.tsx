import { cn } from "@/lib/utils";
import { ArrowLeft, Reply, Forward, Archive, Trash2, CheckSquare, Filter, Tag, FolderInput, ChevronRight, MessageSquare, CalendarPlus, Paperclip, Download, FileArchive, FileText, File, Eye } from "lucide-react";
import { useEmailDetail, useArchiveEmail, useDeleteEmail, useMoveEmail, useMailFolders } from "@/hooks/useMicrosoft";
import { useLinkedOutlookEmailDetail, useGmailEmailDetail, useRoutedEmailAttachments, fetchRoutedAttachmentBlob, type EmailAttachmentMeta } from "@/hooks/useLinkedAccounts";
import { useResolvedEmailHtml } from "@/hooks/useResolvedEmailHtml";
import { MailLabelPicker } from "./MailLabelPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { inferMimeFromFileName, type OutlookAttachment } from "@/lib/outlookEmailMedia";
import { toast } from "sonner";

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

/** Envuelve un botón de ícono para mostrar su nombre al pasar el ratón (tooltip instantáneo). */
function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-[11px]">{label}</TooltipContent>
    </Tooltip>
  );
}

function AttachmentChip({ messageId, att }: { messageId: string; att: OutlookAttachment }) {
  const [loading, setLoading] = useState(false);

  const isArchive = /\.(zip|rar|7z|tar|gz)$/i.test(att.name || "");
  const Icon = isArchive ? FileArchive : /\.(pdf|docx?|xlsx?|pptx?|csv|txt)$/i.test(att.name || "") ? FileText : File;
  // Tipos que el navegador puede mostrar directo (PDF e imágenes) → botón "Ver".
  const isViewable = /\.(pdf|png|jpe?g|gif|webp|svg|bmp)$/i.test(att.name || "");

  const resolveBlobUrl = useCallback(async () => {
    // fetchRoutedAttachmentBlob rutea por prefijo del ID (principal / outlook / gmail).
    const r = await fetchRoutedAttachmentBlob(messageId, att as unknown as EmailAttachmentMeta);
    const fromApi = (r.contentType || "").toLowerCase();
    const inferred = inferMimeFromFileName(att.name || r.name || "");
    const mime = fromApi && fromApi !== "application/octet-stream" ? r.contentType : inferred || "application/octet-stream";
    const blob = new Blob([r.blob], { type: mime });
    return { url: URL.createObjectURL(blob), name: att.name || r.name || "adjunto" };
  }, [messageId, att]);

  const download = useCallback(async () => {
    setLoading(true);
    try {
      const { url, name } = await resolveBlobUrl();
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast.error("No se pudo descargar el adjunto: " + (e instanceof Error ? e.message : "Error desconocido"));
    } finally {
      setLoading(false);
    }
  }, [resolveBlobUrl]);

  const view = useCallback(async () => {
    setLoading(true);
    try {
      const { url } = await resolveBlobUrl();
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error("No se pudo abrir el adjunto: " + (e instanceof Error ? e.message : "Error desconocido"));
    } finally {
      setLoading(false);
    }
  }, [resolveBlobUrl]);

  const sizeLabel = att.size > 1024 * 1024
    ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(att.size / 1024)} KB`;

  return (
    <div className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border/60 bg-muted/30 hover:border-border transition-colors min-w-0 max-w-[260px]">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] font-medium truncate">{att.name || "adjunto"}</span>
        <span className="block text-[10.5px] text-muted-foreground">{sizeLabel}</span>
      </span>
      {isViewable && (
        <button
          type="button"
          onClick={view}
          disabled={loading}
          title="Ver"
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-60 shrink-0"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={download}
        disabled={loading}
        title="Descargar"
        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-60 shrink-0"
      >
        <Download className={cn("w-3.5 h-3.5", loading && "animate-bounce")} />
      </button>
    </div>
  );
}

export function MailReadingOverlay({ emailId, open, onClose, onCompose, onForward, onCreateTask, onCreateRule, onSendToSlack, onCreateEvent }: Props) {
  // Route detail fetch by ID prefix: "outlook:{accountId}:{id}" or "gmail:{accountId}:{id}"
  const emailParts = (emailId ?? "").split(":");
  const emailPfx = emailParts[0];
  const emailAccId = emailParts.length >= 3 ? emailParts[1] : "";
  const isLinkedOutlookEmail = emailPfx === "outlook" && !!emailAccId && !!emailId;
  const isLinkedGmailEmail = emailPfx === "gmail" && !!emailAccId && !!emailId;
  const isPrimaryEmail = !isLinkedOutlookEmail && !isLinkedGmailEmail;

  const { data: primaryDetail, isLoading: primaryLoading } = useEmailDetail(isPrimaryEmail ? emailId : null);
  const { data: linkedOutlookDetail, isLoading: linkedOutlookLoading } = useLinkedOutlookEmailDetail(
    isLinkedOutlookEmail ? emailAccId : null,
    isLinkedOutlookEmail ? emailId : null,
  );
  const { data: linkedGmailDetail, isLoading: linkedGmailLoading } = useGmailEmailDetail(
    isLinkedGmailEmail ? emailAccId : null,
    isLinkedGmailEmail ? emailId : null,
  );

  const emailDetail = isLinkedOutlookEmail ? linkedOutlookDetail :
    isLinkedGmailEmail ? linkedGmailDetail :
    primaryDetail;
  const isLoading = isLinkedOutlookEmail ? linkedOutlookLoading :
    isLinkedGmailEmail ? linkedGmailLoading :
    primaryLoading;

  const { data: attachments = [] } = useRoutedEmailAttachments(emailId ?? null);
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
  const sensitivity = (emailDetail as any)?.sensitivity as string | undefined;
  const isConfidential = sensitivity === "confidential" || sensitivity === "private";

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
            <Tip label="Mover a carpeta">
              <PopoverTrigger asChild>
                <button
                  className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <FolderInput className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
            </Tip>
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

          <Tip label="Crear regla">
            <button
              className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={onCreateRule}
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
          </Tip>
          <MailLabelPicker emailMessageId={emailId || ""}>
            <button
              className="h-[30px] flex items-center gap-1.5 px-2.5 rounded-md border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Etiquetas"
            >
              <Tag className="w-3.5 h-3.5" />
              Etiqueta
            </button>
          </MailLabelPicker>
          <Tip label="Archivar">
            <button
              className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => { if (emailId) { archiveEmail.mutate(emailId); onClose(); } }}
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          </Tip>
          <Tip label="Eliminar">
            <button
              className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              onClick={() => { if (emailId) { deleteEmail.mutate(emailId); onClose(); } }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tip>
          <Tip label="Crear tarea">
            <button
              className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => emailDetail && onCreateTask(emailDetail as EmailShape)}
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
          </Tip>
          <Tip label="Crear evento en calendario">
            <button
              className="h-[30px] w-[30px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={onCreateEvent}
            >
              <CalendarPlus className="w-3.5 h-3.5" />
            </button>
          </Tip>
          <Tip label={isConfidential ? "Confidencial — no se puede enviar a Slack" : "Enviar a Slack"}>
            <button
              className={cn(
                "h-[30px] w-[30px] flex items-center justify-center rounded-md transition-colors",
                isConfidential
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              onClick={isConfidential ? undefined : onSendToSlack}
              disabled={isConfidential}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          </Tip>
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
            <div className="flex items-start gap-2 mb-4">
              <h1 className="text-[22px] font-bold tracking-tight text-foreground leading-tight flex-1">
                {(emailDetail as any).subject || "(sin asunto)"}
              </h1>
              {isConfidential && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10.5px] font-semibold shrink-0 mt-1.5 dark:bg-amber-900/30 dark:text-amber-400">
                  <Lock className="w-3 h-3" />
                  Confidencial
                </span>
              )}
            </div>
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

            {/* Adjuntos descargables */}
            {(() => {
              const downloadable = (attachments as OutlookAttachment[]).filter(
                (a) =>
                  !a["@odata.type"]?.includes("itemAttachment") &&
                  !a["@odata.type"]?.includes("referenceAttachment") &&
                  !a.isInline,
              );
              if (!downloadable.length || !emailId) return null;
              return (
                <div className="mt-6 pt-5 border-t border-border/40">
                  <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    <Paperclip className="w-3.5 h-3.5" />
                    {downloadable.length} adjunto{downloadable.length > 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {downloadable.map((att) => (
                      <AttachmentChip key={att.id} messageId={emailId} att={att} />
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <span className="text-3xl">⚠️</span>
            <p className="text-[14px] font-semibold text-foreground">No se pudo abrir este correo</p>
            <p className="text-[12.5px] text-muted-foreground max-w-sm">
              El contenido no se pudo cargar. Vuelve a la lista e inténtalo de nuevo, o abre otro correo.
            </p>
            <button
              onClick={onClose}
              className="mt-1 h-8 px-4 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors"
            >
              ← Volver a la lista
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
