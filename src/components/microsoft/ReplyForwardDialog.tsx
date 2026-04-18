import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/microsoft/RichTextEditor";
import { EmailAIAssistant } from "@/components/microsoft/EmailAIAssistant";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useCancelScheduledMailJob, usePendingScheduledMailJobs } from "@/hooks/useMicrosoft";
import { Loader2, Send, Sparkles, CalendarClock, ChevronDown } from "lucide-react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { Switch } from "@/components/ui/switch";
import { emailLimits, withLimits } from "@/lib/fileIntake/limits";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

export type ReplyForwardAction = "reply" | "reply-all" | "forward";

function aiProposalToEmailHtml(text: string): string {
  const t = text.trim();
  if (!t) return "<p></p>";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<p>${esc(t).replace(/\n/g, "<br>")}</p>`;
}

function draftHasMeaningfulText(html: string): boolean {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length > 0;
}

function toDatetimeLocalValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface ReplyForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: ReplyForwardAction;
  emailDetail: Record<string, unknown> | null | undefined;
  threadContextForAi: string;
  draftId: string | null;
  draftHtml: string;
  setDraftHtml: (v: string | ((prev: string) => string)) => void;
  forwardTo: string;
  setForwardTo: (v: string) => void;
  replyFiles: File[];
  onReplyFilesChange: (files: File[]) => void;
  showFullAI: boolean;
  setShowFullAI: (v: boolean) => void;
  createReplyDraftPending: boolean;
  createForwardDraftPending: boolean;
  isSending: boolean;
  isScheduling?: boolean;
  onCancel: () => void;
  onSend: () => void;
  /** Programar envío (solo con borrador Graph). `scheduledAt` en ISO 8601. */
  onScheduleMail?: (scheduledAtIso: string) => void | Promise<void>;
}

export function ReplyForwardDialog({
  open,
  onOpenChange,
  action,
  emailDetail,
  threadContextForAi,
  draftId,
  draftHtml,
  setDraftHtml,
  forwardTo,
  setForwardTo,
  replyFiles,
  onReplyFilesChange,
  showFullAI,
  setShowFullAI,
  createReplyDraftPending,
  createForwardDraftPending,
  isSending,
  isScheduling = false,
  onCancel,
  onSend,
  onScheduleMail,
}: ReplyForwardDialogProps) {
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [keepZips, setKeepZips] = useState(true);
  const { data: pendingJobs = [], isLoading: pendingLoading } = usePendingScheduledMailJobs(
    open && !!onScheduleMail,
  );
  const cancelScheduled = useCancelScheduledMailJob();

  const title =
    action === "reply" ? "Responder" : action === "reply-all" ? "Responder a todos" : "Reenviar";

  const subject = typeof emailDetail?.subject === "string" ? emailDetail.subject : "";
  const bodyContent =
    (emailDetail?.body as { content?: string } | undefined)?.content != null
      ? String((emailDetail?.body as { content?: string }).content)
      : "";
  const senderName =
    (emailDetail?.from as { emailAddress?: { name?: string } } | undefined)?.emailAddress?.name;

  const preparing = createReplyDraftPending || createForwardDraftPending;

  const minScheduleLocal = useMemo(() => toDatetimeLocalValue(new Date(Date.now() + 60_000)), [open]);

  useEffect(() => {
    if (!open) return;
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    setScheduleAt(toDatetimeLocalValue(d));
  }, [open]);

  const handleProgramar = async () => {
    if (!onScheduleMail || !draftId) {
      toast.error("No hay borrador para programar.");
      return;
    }
    const local = new Date(scheduleAt);
    if (Number.isNaN(local.getTime())) {
      toast.error("Fecha u hora no válida.");
      return;
    }
    if (local.getTime() <= Date.now() + 30_000) {
      toast.error("Elige una hora al menos un minuto en el futuro.");
      return;
    }
    await onScheduleMail(local.toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(100vw-1.5rem,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 text-left sm:px-6">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {subject ? (
            <p className="text-xs text-muted-foreground truncate font-normal mt-1" title={subject}>
              {subject}
            </p>
          ) : null}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="space-y-3 border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Asistente</span>
              <Button
                variant={showFullAI ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setShowFullAI(!showFullAI)}
              >
                <Sparkles className="h-3.5 w-3.5" /> Kawiil AI
              </Button>
            </div>
            {showFullAI && (
              <EmailAIAssistant
                key={draftId || "no-draft"}
                mode="full"
                conversationKey={draftId || undefined}
                emailSubject={subject}
                emailBody={bodyContent}
                senderName={senderName}
                threadContext={threadContextForAi}
                draftHtml={draftHtml}
                hasDraftText={draftHasMeaningfulText(draftHtml)}
                onInsertText={(text) =>
                  setDraftHtml((prev) => `<p>${text.replace(/\n/g, "<br>")}</p>${prev}`)
                }
                insertIntoDraftOnComplete
                onReplaceDraft={(text) => setDraftHtml(aiProposalToEmailHtml(text))}
                onClose={() => setShowFullAI(false)}
              />
            )}
          </div>

          <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
            {action === "forward" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Para</Label>
                <Input
                  placeholder="Separar con coma: correo@ejemplo.com"
                  value={forwardTo}
                  onChange={(e) => setForwardTo(e.target.value)}
                  className="text-sm h-9"
                />
              </div>
            )}

            {preparing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                {action === "forward" ? "Preparando reenvío con firma…" : "Preparando respuesta con firma…"}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cuerpo</Label>
                  <div className="min-h-[200px] rounded-md border border-input">
                    <RichTextEditor
                      key={draftId || "new"}
                      initialHtml={draftHtml}
                      placeholder={action === "forward" ? "Mensaje al reenviar…" : "Escribe tu respuesta…"}
                      onHtmlChange={setDraftHtml}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Adjuntos</span>
                    <label className="inline-flex items-center gap-2 shrink-0">
                      <Switch checked={keepZips} onCheckedChange={setKeepZips} />
                      <span className="text-xs">Mantener .zip</span>
                    </label>
                  </div>
                  <FileDropzone
                    files={replyFiles}
                    onChange={onReplyFilesChange}
                    limits={withLimits(emailLimits, {
                      accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.rar,.7z,.msg,.eml",
                      zipMode: keepZips ? "keep" : "auto",
                    })}
                    variant="area"
                    hint="Arrastra archivos o haz click"
                    subhint={keepZips ? "Los .zip se envían tal cual" : "Los .zip se expanden y se envían como archivos"}
                    showSize
                  />
                </div>

                {onScheduleMail && draftId && (
                  <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Programar envío
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs text-muted-foreground">Fecha y hora local</Label>
                        <Input
                          type="datetime-local"
                          className="text-sm h-9"
                          value={scheduleAt}
                          min={minScheduleLocal}
                          onChange={(e) => setScheduleAt(e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-9 shrink-0"
                        disabled={isScheduling || isSending || preparing || !draftHtml.trim()}
                        onClick={() => void handleProgramar()}
                      >
                        {isScheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Programar
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      El borrador debe seguir existiendo en Outlook hasta la hora programada. Si lo eliminas, el envío
                      fallará.
                    </p>
                  </div>
                )}

                {onScheduleMail ? (
                  <Collapsible open={scheduledOpen} onOpenChange={setScheduledOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/30"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          Envíos programados
                          {pendingJobs.length > 0 ? (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary shrink-0">
                              {pendingJobs.length}
                            </span>
                          ) : null}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${scheduledOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      {pendingLoading ? (
                        <p className="text-xs text-muted-foreground py-2">Cargando…</p>
                      ) : pendingJobs.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">No hay envíos pendientes.</p>
                      ) : (
                        <ul className="space-y-2 text-xs">
                          {pendingJobs.map((job) => (
                            <li
                              key={job.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-2 py-2"
                            >
                              <span className="text-muted-foreground">
                                {format(parseISO(job.scheduled_at), "PPp", { locale: es })}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={cancelScheduled.isPending}
                                onClick={() => cancelScheduled.mutate(job.id)}
                              >
                                Cancelar
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6 gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" className="h-9" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={onSend}
            disabled={isSending || isScheduling || !draftHtml.trim() || preparing}
          >
            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {action === "forward" ? "Reenviar" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
