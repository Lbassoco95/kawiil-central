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
import { Loader2, Send, Sparkles, Paperclip, X } from "lucide-react";
import type { ComposerAttachment } from "@/lib/emailComposer";

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

export interface ReplyForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: ReplyForwardAction;
  emailDetail: Record<string, unknown> | null | undefined;
  selectedEmailId: string | null;
  threadContextForAi: string;
  draftId: string | null;
  draftHtml: string;
  setDraftHtml: (v: string | ((prev: string) => string)) => void;
  forwardTo: string;
  setForwardTo: (v: string) => void;
  replyAttachments: ComposerAttachment[];
  showFullAI: boolean;
  setShowFullAI: (v: boolean) => void;
  createReplyDraftPending: boolean;
  createForwardDraftPending: boolean;
  isSending: boolean;
  onCancel: () => void;
  onSend: () => void;
  onAttachmentPick: (files: FileList | null) => void;
  onRemoveAttachment: (file: ComposerAttachment) => void;
}

export function ReplyForwardDialog({
  open,
  onOpenChange,
  action,
  emailDetail,
  selectedEmailId,
  threadContextForAi,
  draftId,
  draftHtml,
  setDraftHtml,
  forwardTo,
  setForwardTo,
  replyAttachments,
  showFullAI,
  setShowFullAI,
  createReplyDraftPending,
  createForwardDraftPending,
  isSending,
  onCancel,
  onSend,
  onAttachmentPick,
  onRemoveAttachment,
}: ReplyForwardDialogProps) {
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
            {showFullAI && selectedEmailId && (
              <EmailAIAssistant
                mode="full"
                emailSubject={subject}
                emailBody={bodyContent}
                senderName={senderName}
                threadContext={threadContextForAi}
                hasDraftText={draftHasMeaningfulText(draftHtml)}
                onInsertText={(text) =>
                  setDraftHtml((prev) => `<p>${text.replace(/\n/g, "<br>")}</p>${prev}`)
                }
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
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs">Adjuntos</span>
                    <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs">
                      <Paperclip className="mr-1 h-3.5 w-3.5" />
                      Adjuntar
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => onAttachmentPick(e.target.files)}
                      />
                    </label>
                  </div>
                  {replyAttachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {replyAttachments.map((file) => (
                        <div
                          key={`${file.name}-${file.size}`}
                          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                        >
                          <span className="max-w-[200px] truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => onRemoveAttachment(file)}
                            aria-label={`Quitar ${file.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
            disabled={isSending || !draftHtml.trim() || preparing}
          >
            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {action === "forward" ? "Reenviar" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
