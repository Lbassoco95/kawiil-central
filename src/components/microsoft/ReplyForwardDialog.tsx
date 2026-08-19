import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/microsoft/RichTextEditor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useCancelScheduledMailJob, usePendingScheduledMailJobs } from "@/hooks/useMicrosoft";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Send,
  Sparkles,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Pencil,
  X,
  Wand2,
} from "lucide-react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { Switch } from "@/components/ui/switch";
import { EMAIL_ATTACHMENT_ACCEPT } from "@/lib/emailComposer";
import { emailLimits, withLimits } from "@/lib/fileIntake/limits";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import { QUICK_DRAFT_TEMPLATES } from "@/components/microsoft/emailComposeAiShared";
import { useEmailComposeAiAssist } from "@/hooks/useEmailComposeAiAssist";
import { AccountingTemplatePicker } from "@/components/accounting/AccountingTemplatePicker";
import { TemplatePickerBoundary } from "@/components/accounting/TemplatePickerBoundary";
import type { ComposeDefaultTemplateContext } from "@/components/microsoft/ComposeEmailDialog";
import type { SentAccountingEmailInfo } from "@/lib/accountingEmailStepSync";

export type ReplyForwardAction = "reply" | "reply-all" | "forward";

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
  forwardCc: string;
  setForwardCc: (v: string) => void;
  forwardBcc: string;
  setForwardBcc: (v: string) => void;
  replyTo: string;
  setReplyTo: (v: string) => void;
  replyCc: string;
  setReplyCc: (v: string) => void;
  replyBcc: string;
  setReplyBcc: (v: string) => void;
  replyFiles: File[];
  onReplyFilesChange: (files: File[]) => void;
  createReplyDraftPending: boolean;
  createForwardDraftPending: boolean;
  isSending: boolean;
  isScheduling?: boolean;
  onCancel: () => void;
  onSend: () => void;
  /** Programar envío (solo con borrador Graph). `scheduledAt` en ISO 8601. */
  onScheduleMail?: (scheduledAtIso: string) => void | Promise<void>;
  requestDeliveryReceipt: boolean;
  requestReadReceipt: boolean;
  onRequestDeliveryReceiptChange: (v: boolean) => void;
  onRequestReadReceiptChange: (v: boolean) => void;
  /** Sin borrador de Graph no se pueden aplicar estas solicitudes (envío rápido). */
  receiptsDisabled: boolean;
  defaultTemplateContext?: ComposeDefaultTemplateContext;
  showAccountingTemplates?: boolean;
  /**
   * Se dispara al insertar una plantilla contable. El padre guarda la info y,
   * tras el envío exitoso, cierra el paso del periodo con
   * `useAccountingEmailStepSync` (ver `src/lib/accountingEmailStepSync.ts`).
   */
  onTemplateApplied?: (info: SentAccountingEmailInfo) => void;
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
  forwardCc,
  setForwardCc,
  forwardBcc,
  setForwardBcc,
  replyTo,
  setReplyTo,
  replyCc,
  setReplyCc,
  replyBcc,
  setReplyBcc,
  replyFiles,
  onReplyFilesChange,
  createReplyDraftPending,
  createForwardDraftPending,
  isSending,
  isScheduling = false,
  onCancel,
  onSend,
  onScheduleMail,
  requestDeliveryReceipt,
  requestReadReceipt,
  onRequestDeliveryReceiptChange,
  onRequestReadReceiptChange,
  receiptsDisabled,
  defaultTemplateContext,
  showAccountingTemplates = true,
  onTemplateApplied,
}: ReplyForwardDialogProps) {
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [keepZips, setKeepZips] = useState(true);
  const [showReplyCcBlock, setShowReplyCcBlock] = useState(false);
  const [showReplyBcc, setShowReplyBcc] = useState(false);
  const [showForwardCcBlock, setShowForwardCcBlock] = useState(false);
  const [showForwardBcc, setShowForwardBcc] = useState(false);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const { data: pendingJobs = [], isLoading: pendingLoading } = usePendingScheduledMailJobs(
    open && !!onScheduleMail,
  );
  const cancelScheduled = useCancelScheduledMailJob();

  const title =
    action === "reply" ? "Responder" : action === "reply-all" ? "Responder a todos" : "Reenviar";

  const subject = typeof emailDetail?.subject === "string" ? emailDetail.subject : "";

  const preparing = createReplyDraftPending || createForwardDraftPending;

  const minScheduleLocal = useMemo(() => toDatetimeLocalValue(new Date(Date.now() + 60_000)), [open]);

  const toLabel = useMemo(() => {
    if (action === "forward") {
      const parts = [forwardTo, forwardCc, forwardBcc].map((s) => s.trim()).filter(Boolean);
      return parts.length ? parts.join("; ") : "(destinatarios)";
    }
    const parts = [replyTo, replyCc, replyBcc].map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts.join("; ") : "(destinatarios)";
  }, [action, forwardTo, forwardCc, forwardBcc, replyTo, replyCc, replyBcc]);

  useEffect(() => {
    if (!open) {
      setShowReplyCcBlock(false);
      setShowReplyBcc(false);
      setShowForwardCcBlock(false);
      setShowForwardBcc(false);
      return;
    }
    if (replyCc.trim() || replyBcc.trim()) setShowReplyCcBlock(true);
    if (replyBcc.trim()) setShowReplyBcc(true);
    if (forwardCc.trim() || forwardBcc.trim()) setShowForwardCcBlock(true);
    if (forwardBcc.trim()) setShowForwardBcc(true);
  }, [open, replyCc, replyBcc, forwardCc, forwardBcc]);

  const getBodyHtml = useCallback(() => draftHtml, [draftHtml]);

  const {
    aiPanelOpen,
    setAiPanelOpen,
    aiInstruction,
    setAiInstruction,
    aiLoading,
    hasAiDraft,
    improveBusy,
    lastInstructionRef,
    runAiDraft,
    runImproveBody,
  } = useEmailComposeAiAssist({
    open,
    subject,
    toLabel,
    threadContext: threadContextForAi,
    getBodyHtml,
    setBodyHtml: (html) => setDraftHtml(html),
    editorRef,
  });

  const bodyEmpty =
    draftHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length === 0;

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

  const receiptsWrap = (node: ReactNode) =>
    receiptsDisabled ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-not-allowed opacity-60">{node}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          Solo disponible cuando Outlook prepara un borrador. Espera a que termine de cargar o reintenta la acción.
        </TooltipContent>
      </Tooltip>
    ) : (
      node
    );

  const applyAccountingTemplate = useCallback(
    (result: { subject: string; bodyHtml: string; template?: { category?: string | null } }) => {
      void result.subject;
      editorRef.current?.setHtml(result.bodyHtml);
      setDraftHtml(result.bodyHtml);
      onTemplateApplied?.({
        templateCategory: result.template?.category ?? null,
        clientId: defaultTemplateContext?.clientId ?? null,
        clientName: defaultTemplateContext?.razon_social ?? null,
        projectId: defaultTemplateContext?.projectId ?? null,
        periodId: defaultTemplateContext?.periodId ?? null,
        subject: subject || null,
      });
    },
    [setDraftHtml, onTemplateApplied, defaultTemplateContext, subject],
  );

  const iaToolbarButton = (
    <div className="flex items-center gap-1">
      {showAccountingTemplates ? (
        <TemplatePickerBoundary>
          <AccountingTemplatePicker
            onApply={applyAccountingTemplate}
            defaults={defaultTemplateContext as Record<string, string> | undefined}
            onClientSelected={(client) => {
              onTemplateApplied?.({ clientId: client.id, clientName: client.name });
              if (!client.email) return;
              if (action === "forward" && !forwardTo.trim()) setForwardTo(client.email);
              if ((action === "reply" || action === "reply-all") && !replyTo.trim()) setReplyTo(client.email);
            }}
          />
        </TemplatePickerBoundary>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 gap-1 text-xs h-7 px-2"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAiPanelOpen((v) => !v)}
      >
        <Sparkles className="h-3.5 w-3.5" />
        IA
      </Button>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92vh] min-h-0 w-[min(100vw-1.5rem,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl rounded-2xl border-sky-200/40 dark:border-sky-900/40 [&>button.absolute]:hidden">
          <header
            className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-white"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
                <Pencil className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight">
                  {title}
                  <Badge
                    variant="outline"
                    className="ml-0.5 h-4 border-white/40 bg-white/10 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-white"
                  >
                    v2.4
                  </Badge>
                </p>
                <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80" title={subject || undefined}>
                  {subject?.trim()
                    ? subject.trim()
                    : "Asistente Kawiil listo para ayudarte a redactar"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px] text-white hover:bg-white/15 disabled:opacity-50"
                onClick={() => setAiPanelOpen((v) => !v)}
                title="Abrir asistente Kawiil para redactar"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiPanelOpen ? "Cerrar IA" : "Asistente"}
              </Button>
              <button
                type="button"
                className="rounded-md p-1.5 text-white/90 hover:bg-white/15"
                onClick={() => onOpenChange(false)}
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!preparing && draftHtml.trim() && !isSending && !isScheduling) onSend();
              }
            }}
          >
            <div className="space-y-3 pb-8 sm:pb-10">
              {(action === "reply" || action === "reply-all") && !preparing && (
                <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Destinatarios</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Para</Label>
                    <Input
                      placeholder="correo@ejemplo.com; puedes separar con coma o punto y coma"
                      value={replyTo}
                      onChange={(e) => setReplyTo(e.target.value)}
                      className="text-sm h-9"
                      disabled={!draftId}
                    />
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => {
                          setShowReplyCcBlock((v) => {
                            if (v) setShowReplyBcc(false);
                            return !v;
                          });
                        }}
                      >
                        CC / CCO{" "}
                        {showReplyCcBlock ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
                      </Button>
                      {!draftId ? (
                        <span className="text-[10px] text-muted-foreground">Disponible cuando el borrador esté listo</span>
                      ) : null}
                    </div>
                    {showReplyCcBlock && (
                      <div className="space-y-2 pt-1">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Copia (CC)</Label>
                          <Input
                            placeholder="copia@ejemplo.com"
                            value={replyCc}
                            onChange={(e) => setReplyCc(e.target.value)}
                            className="text-sm h-9"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reply-show-bcc"
                            checked={showReplyBcc}
                            onCheckedChange={setShowReplyBcc}
                          />
                          <Label htmlFor="reply-show-bcc" className="text-xs text-muted-foreground cursor-pointer">
                            Copia oculta (CCO)
                          </Label>
                        </div>
                        {showReplyBcc && (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">CCO</Label>
                            <Input
                              placeholder="oculto@ejemplo.com"
                              value={replyBcc}
                              onChange={(e) => setReplyBcc(e.target.value)}
                              className="text-sm h-9"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {action === "forward" && (
                <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Destinatarios</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Para</Label>
                    <Input
                      placeholder="Separar con coma o punto y coma"
                      value={forwardTo}
                      onChange={(e) => setForwardTo(e.target.value)}
                      className="text-sm h-9"
                    />
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => {
                          setShowForwardCcBlock((v) => {
                            if (v) setShowForwardBcc(false);
                            return !v;
                          });
                        }}
                      >
                        CC / CCO{" "}
                        {showForwardCcBlock ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
                      </Button>
                    </div>
                    {showForwardCcBlock && (
                      <div className="space-y-2 pt-1">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Copia (CC)</Label>
                          <Input
                            placeholder="copia@ejemplo.com"
                            value={forwardCc}
                            onChange={(e) => setForwardCc(e.target.value)}
                            className="text-sm h-9"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="fwd-show-bcc"
                            checked={showForwardBcc}
                            onCheckedChange={setShowForwardBcc}
                          />
                          <Label htmlFor="fwd-show-bcc" className="text-xs text-muted-foreground cursor-pointer">
                            Copia oculta (CCO)
                          </Label>
                        </div>
                        {showForwardBcc && (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">CCO</Label>
                            <Input
                              placeholder="oculto@ejemplo.com"
                              value={forwardBcc}
                              onChange={(e) => setForwardBcc(e.target.value)}
                              className="text-sm h-9"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {preparing ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {action === "forward" ? "Preparando reenvío con firma…" : "Preparando respuesta con firma…"}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col space-y-2">
                  {aiPanelOpen && (
                    <div className="rounded-xl border border-sky-200/60 bg-gradient-to-r from-sky-50 to-blue-50 p-3 space-y-2.5 shadow-sm shrink-0 dark:border-sky-800/40 dark:from-sky-950/30 dark:to-blue-950/20">
                      <div className="flex items-center justify-between">
                        <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                          <Sparkles className="h-3 w-3" />
                          Asistente Kawiil · ¿Qué quieres decir?
                        </p>
                      </div>
                      <Input
                        placeholder="Ej: confirma la reunión del martes a las 10am con Juan"
                        value={aiInstruction}
                        onChange={(e) => setAiInstruction(e.target.value)}
                        disabled={aiLoading}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void runAiDraft(aiInstruction);
                          }
                        }}
                        className="bg-background"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                          Plantillas:
                        </span>
                        {QUICK_DRAFT_TEMPLATES.map((tpl) => {
                          const Icon = tpl.icon;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              disabled={aiLoading}
                              onClick={() => {
                                setAiInstruction(tpl.instruction);
                                void runAiDraft(tpl.instruction);
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-sky-200/70 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 shadow-sm hover:bg-sky-100/70 disabled:opacity-50 dark:border-sky-800/40 dark:bg-background/60 dark:text-sky-300 dark:hover:bg-sky-500/10"
                            >
                              <Icon className="h-3 w-3" />
                              {tpl.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={aiLoading || !aiInstruction.trim()}
                          onClick={() => void runAiDraft(aiInstruction)}
                          className="gap-1.5 text-white shadow-sm"
                          style={{ background: KAWIIL_AI_GRADIENT }}
                        >
                          {aiLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          Generar borrador
                        </Button>
                        <span className="text-[10.5px] text-muted-foreground">
                          También puedes elegir una plantilla y se generará al instante.
                        </span>
                      </div>
                    </div>
                  )}

                  {!aiPanelOpen && bodyEmpty && (
                    <div className="shrink-0 rounded-xl border border-sky-200/50 bg-gradient-to-r from-sky-50/70 to-blue-50/50 px-3 py-2.5 dark:border-sky-800/30 dark:from-sky-950/20 dark:to-blue-950/15">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                          <Sparkles className="h-3 w-3" />
                          Empieza con una plantilla Kawiil
                        </span>
                        {QUICK_DRAFT_TEMPLATES.map((tpl) => {
                          const Icon = tpl.icon;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => {
                                setAiPanelOpen(true);
                                setAiInstruction(tpl.instruction);
                                void runAiDraft(tpl.instruction);
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-sky-200/70 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 shadow-sm hover:bg-sky-100/70 dark:border-sky-800/40 dark:bg-background/60 dark:text-sky-300 dark:hover:bg-sky-500/10"
                            >
                              <Icon className="h-3 w-3" />
                              {tpl.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {hasAiDraft && (
                    <div
                      className={cn(
                        "shrink-0 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200/60 bg-gradient-to-r from-sky-50 to-blue-50 px-3 py-2 text-[12px] text-sky-800 shadow-sm",
                        "dark:border-sky-800/40 dark:from-sky-950/30 dark:to-blue-950/20 dark:text-sky-200",
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                        <Sparkles className="h-3.5 w-3.5" />
                        Borrador generado por Kawiil AI
                      </span>
                      <span className="text-sky-300">·</span>
                      {lastInstructionRef.current ? (
                        <button
                          type="button"
                          className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                          disabled={aiLoading}
                          onClick={() => void runAiDraft(lastInstructionRef.current)}
                        >
                          {aiLoading ? "Regenerando…" : "Regenerar"}
                        </button>
                      ) : null}
                      <span className="text-sky-300">·</span>
                      <button
                        type="button"
                        className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={!!improveBusy}
                        onClick={() => void runImproveBody("formal")}
                      >
                        {improveBusy === "formal" ? "Aplicando…" : "Más formal"}
                      </button>
                      <span className="text-sky-300">·</span>
                      <button
                        type="button"
                        className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={!!improveBusy}
                        onClick={() => void runImproveBody("shorter")}
                      >
                        {improveBusy === "shorter" ? "Aplicando…" : "Más corto"}
                      </button>
                      <span className="text-sky-300">·</span>
                      <button
                        type="button"
                        className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={!!improveBusy}
                        onClick={() => void runImproveBody("friendly")}
                      >
                        {improveBusy === "friendly" ? "Aplicando…" : "Más amigable"}
                      </button>
                    </div>
                  )}

                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-xs text-muted-foreground">Cuerpo</Label>
                    <RichTextEditor
                      ref={editorRef}
                      key={draftId || "new"}
                      initialHtml={draftHtml}
                      placeholder={action === "forward" ? "Mensaje al reenviar…" : "Escribe tu respuesta…"}
                      onHtmlChange={setDraftHtml}
                      toolbarEndSlot={iaToolbarButton}
                      className={cn(
                        "min-h-[min(40vh,360px)] sm:min-h-[320px] max-h-[min(56vh,560px)] flex flex-col overflow-hidden",
                        "[&>div:first-child]:shrink-0",
                        "[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:overflow-y-auto",
                      )}
                    />
                  </div>

                  <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 space-y-2 shrink-0">
                    <p className="text-[11px] font-medium text-muted-foreground">Confirmaciones (como en Outlook)</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                      {receiptsWrap(
                        <label
                          className={`flex items-center gap-2 text-xs select-none ${receiptsDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <Switch
                            checked={requestDeliveryReceipt}
                            onCheckedChange={onRequestDeliveryReceiptChange}
                            disabled={receiptsDisabled}
                            aria-label="Solicitar confirmación de entrega"
                          />
                          <span>Solicitar confirmación de entrega (acuse de recibo)</span>
                        </label>,
                      )}
                      {receiptsWrap(
                        <label
                          className={`flex items-center gap-2 text-xs select-none ${receiptsDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <Switch
                            checked={requestReadReceipt}
                            onCheckedChange={onRequestReadReceiptChange}
                            disabled={receiptsDisabled}
                            aria-label="Solicitar confirmación de lectura"
                          />
                          <span>Solicitar confirmación de lectura</span>
                        </label>,
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      El servidor o el destinatario pueden no enviar confirmaciones; es el mismo comportamiento que en
                      Outlook.
                    </p>
                  </div>

                  <div className="space-y-2 shrink-0">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        Adjuntos (documentos, imágenes, zip…). El asunto lo define el borrador de Outlook; Para, CC y
                        CCO puedes editarlos arriba.
                      </span>
                      <label className="inline-flex items-center gap-2 shrink-0">
                        <Switch checked={keepZips} onCheckedChange={setKeepZips} />
                        <span className="text-xs">Mantener .zip</span>
                      </label>
                    </div>
                    <FileDropzone
                      files={replyFiles}
                      onChange={onReplyFilesChange}
                      limits={withLimits(emailLimits, {
                        accept: EMAIL_ATTACHMENT_ACCEPT,
                        zipMode: keepZips ? "keep" : "auto",
                      })}
                      variant="area"
                      hint="Arrastra archivos o haz click"
                      subhint={
                        keepZips ? "Los .zip se envían tal cual" : "Los .zip se expanden y se envían como archivos"
                      }
                      showSize
                      className="shrink-0"
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
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-6">
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">
              Cancelar
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5 text-white shadow-sm hover:opacity-90 disabled:opacity-60"
                style={{ background: KAWIIL_AI_GRADIENT }}
                disabled={!!improveBusy || aiLoading || preparing}
                onClick={() => void runImproveBody("improve")}
                title="Mejorar el cuerpo del correo con Kawiil AI"
              >
                {improveBusy === "improve" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Mejorar con AI
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={onSend}
                disabled={isSending || isScheduling || !draftHtml.trim() || preparing}
              >
                {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {action === "forward" ? "Reenviar" : "Enviar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
