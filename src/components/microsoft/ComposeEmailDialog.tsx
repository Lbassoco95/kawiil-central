import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { emailLimits, withLimits } from "@/lib/fileIntake/limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/microsoft/RichTextEditor";
import { useSendNewEmail, useOutlookComposeSignature, useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useMailDirectoryContacts, useSyncMailDirectory } from "@/hooks/useMailDirectory";
import { ComposeRecipientInput } from "@/components/microsoft/ComposeRecipientInput";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/functions-js";
import {
  Loader2,
  Send,
  ChevronDown,
  ChevronUp,
  Sparkles,
  BookUser,
  Pencil,
  X,
  Wand2,
  Wand,
  CalendarClock,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  EMAIL_ATTACHMENT_ACCEPT,
  filesToComposerAttachments,
  parseRecipients,
  validateRecipientGroups,
  sanitizeSignatureHtml,
  type ComposerAttachment,
} from "@/lib/emailComposer";
import { AccountingTemplatePicker, type AccountingTemplatePickerApplied } from "@/components/accounting/AccountingTemplatePicker";
import { TemplatePickerBoundary } from "@/components/accounting/TemplatePickerBoundary";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

async function extractFnError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context;
    if (res instanceof Response) {
      try {
        const body = await res.clone().json() as { error?: string; message?: string };
        const msg = body?.message || body?.error;
        if (msg) return String(msg).slice(0, 300);
      } catch { /* ignore */ }
    }
  }
  if (error instanceof Error && error.message && !error.message.includes("non-2xx")) return error.message;
  return fallback;
}
import {
  QUICK_DRAFT_TEMPLATES,
  plainTextToEmailHtml,
  type ImproveMode,
} from "@/components/microsoft/emailComposeAiShared";

export interface ComposeDefaultTemplateContext {
  razon_social?: string;
  clientId?: string;
  projectId?: string;
  [key: string]: string | undefined;
}

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill values for the recipient, subject, and body. */
  initialTo?: string;
  initialSubject?: string;
  initialBodyHtml?: string;
  /** Valores precargados para el selector de plantillas contables. */
  defaultTemplateContext?: ComposeDefaultTemplateContext;
  /** Muestra el selector de plantillas del área contable. Por defecto true. */
  showAccountingTemplates?: boolean;
  /** Callback fired after a successful send, with info about the applied template (if any). */
  onAfterSend?: (info: { templateCategory?: string; clientId?: string; clientName?: string }) => void;
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  initialTo,
  initialSubject,
  initialBodyHtml,
  defaultTemplateContext,
  showAccountingTemplates = true,
  onAfterSend,
}: ComposeEmailDialogProps) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(true);
  const [showBcc, setShowBcc] = useState(true);
  const [editorKey, setEditorKey] = useState(0);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [hasAiDraft, setHasAiDraft] = useState(false);
  const [improveBusy, setImproveBusy] = useState<ImproveMode | null>(null);
  const [subjectSuggesting, setSubjectSuggesting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [keepZips, setKeepZips] = useState(true);
  const [requestDeliveryReceipt, setRequestDeliveryReceipt] = useState(false);
  const [requestReadReceipt, setRequestReadReceipt] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | null>(null);
  const [scheduleDateInput, setScheduleDateInput] = useState("");
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [appliedTemplateInfo, setAppliedTemplateInfo] = useState<{
    templateCategory?: string;
    clientId?: string;
    clientName?: string;
  } | null>(null);
  const lastInstructionRef = useRef("");
  const bodyRef = useRef("");
  const editorRef = useRef<RichTextEditorHandle>(null);
  const signatureAppliedRef = useRef(false);
  const directorySyncRef = useRef(false);
  const { user } = useAuth();
  const sendEmail = useSendNewEmail();
  const { data: orgUsers = [] } = useOrgUsers();
  const { isConnected } = useMicrosoftConnection();
  const { data: mailContacts = [] } = useMailDirectoryContacts(open && isConnected);
  const { mutate: syncDirectoryMutate, isPending: syncDirectoryPending } = useSyncMailDirectory();
  const { data: composeSignature } = useOutlookComposeSignature(open);

  const teamEmailLowerSet = useMemo(() => {
    const s = new Set<string>();
    for (const u of orgUsers) {
      const e = (u.email || "").trim().toLowerCase();
      if (e) s.add(e);
    }
    return s;
  }, [orgUsers]);

  useEffect(() => {
    if (open) {
      signatureAppliedRef.current = false;
      setRequestDeliveryReceipt(false);
      setRequestReadReceipt(false);
      if (initialTo) setTo(initialTo);
      if (initialSubject) setSubject(initialSubject);
      if (initialBodyHtml) {
        bodyRef.current = initialBodyHtml;
        signatureAppliedRef.current = true;
      }
      setEditorKey((k) => k + 1);
      // Defensivo: si el token está por expirar (<120s) lo refrescamos antes
      // de que las queries internas (plantillas, contactos, firma) fallen
      // silenciosamente y desaparezcan opciones del UI.
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const expiresAt = data.session?.expires_at;
          if (!expiresAt) return;
          const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
          if (secondsLeft < 120) {
            await supabase.auth.refreshSession();
          }
        } catch (err) {
          console.warn("[ComposeEmailDialog] session refresh check failed", err);
        }
      })();
    } else {
      setTo("");
      setCc("");
      setBcc("");
      setSubject("");
      setShowCc(false);
      setShowBcc(false);
      setAiPanelOpen(false);
      setAiInstruction("");
      setAiLoading(false);
      setHasAiDraft(false);
      lastInstructionRef.current = "";
      bodyRef.current = "";
      setPendingFiles([]);
      setKeepZips(true);
      setRequestDeliveryReceipt(false);
      setRequestReadReceipt(false);
      setScheduleDate(null);
      setScheduleDateInput("");
      setSchedulePickerOpen(false);
      setAppliedTemplateInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      directorySyncRef.current = false;
      return;
    }
    if (!isConnected || directorySyncRef.current) return;
    directorySyncRef.current = true;
    syncDirectoryMutate({ silent: true });
  }, [open, isConnected, syncDirectoryMutate]);

  /** Orden: Kawiil (perfil) → inferida (Enviados) → bloque /me; Graph no expone firma OWA. */
  useEffect(() => {
    if (!open || !composeSignature?.html) return;
    const t = window.setTimeout(() => {
      if (signatureAppliedRef.current) return;
      const raw = bodyRef.current || "";
      const textOnly = raw.replace(/<[^>]+>/g, " ").replace(/\s|&nbsp;/gi, "").trim();
      if (textOnly.length > 0) {
        signatureAppliedRef.current = true;
        return;
      }
      const html = `${sanitizeSignatureHtml(composeSignature.html)}<p><br></p>`;
      editorRef.current?.setHtml(html);
      bodyRef.current = html;
      signatureAppliedRef.current = true;
    }, 150);
    return () => window.clearTimeout(t);
  }, [open, editorKey, composeSignature]);

  const runAiDraft = useCallback(async (instruction: string) => {
    const trimmed = instruction.trim();
    if (!trimmed) {
      toast.error("Escribe qué quieres que redacte la IA");
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-email-draft", {
        body: {
          action: "draft",
          instruction: trimmed,
          context: { subject: subject.trim() || "(sin asunto)", to: to.trim() || "(no indicado)" },
          tone: "formal",
        },
      });
      if (error) {
        throw new Error(await extractFnError(error, "Error al generar borrador"));
      }
      if (data?.error) throw new Error(typeof data.message === "string" ? data.message : data.error);
      const text = data?.text ?? "";
      if (!text) throw new Error("La IA no devolvió texto");
      lastInstructionRef.current = trimmed;
      const html = plainTextToEmailHtml(text);
      editorRef.current?.setHtml(html);
      bodyRef.current = html;
      setHasAiDraft(true);
      toast.success("Borrador generado");
    } catch (e) {
      const msg = await extractFnError(e, "Error al generar borrador");
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  }, [subject, to]);

  const handleSend = async () => {
    const toList = parseRecipients(to);
    const ccList = parseRecipients(cc);
    const bccList = parseRecipients(bcc);
    const recipientsError = validateRecipientGroups({ to: toList, cc: ccList, bcc: bccList });
    if (recipientsError) {
      toast.error(recipientsError);
      return;
    }

    let attachments: ComposerAttachment[] = [];
    if (pendingFiles.length > 0) {
      try {
        attachments = await filesToComposerAttachments(pendingFiles);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudieron adjuntar archivos");
        return;
      }
    }

    await sendEmail.mutateAsync({
      to: toList,
      cc: ccList.length ? ccList : undefined,
      bcc: bccList.length ? bccList : undefined,
      subject: subject || "(Sin asunto)",
      bodyHtml: bodyRef.current || "<p></p>",
      attachments,
      requestDeliveryReceipt,
      requestReadReceipt,
    });

    onOpenChange(false);
    if (appliedTemplateInfo?.templateCategory && onAfterSend) {
      onAfterSend(appliedTemplateInfo);
    }
    setAppliedTemplateInfo(null);
  };

  const handleScheduleSend = async (when: Date) => {
    const toList = parseRecipients(to);
    if (!toList.length) { toast.error("Añade al menos un destinatario"); return; }
    if (!user) { toast.error("No autenticado"); return; }
    let attachments: ComposerAttachment[] = [];
    if (pendingFiles.length > 0) {
      try { attachments = await filesToComposerAttachments(pendingFiles); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Error con adjuntos"); return; }
    }
    try {
      const { error } = await supabase.from("scheduled_mail_jobs").insert({
        user_id: user.id,
        scheduled_at: when.toISOString(),
        kind: "send_new",
        payload: {
          body_html: bodyRef.current || "<p></p>",
          subject: subject || "(Sin asunto)",
          is_delivery_receipt_requested: requestDeliveryReceipt,
          is_read_receipt_requested: requestReadReceipt,
          to_recipients: toList.map(e => ({ emailAddress: { address: e } })),
          cc_recipients: parseRecipients(cc).map(e => ({ emailAddress: { address: e } })),
          bcc_recipients: parseRecipients(bcc).map(e => ({ emailAddress: { address: e } })),
          ...(attachments.length ? { attachments } : {}),
        },
      });
      if (error) throw error;
      toast.success(`Correo programado para ${when.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al programar envío");
    }
  };

  const runImproveBody = useCallback(
    async (mode: ImproveMode) => {
      const currentHtml = (bodyRef.current || "").trim();
      if (!currentHtml) {
        toast.error("Escribe primero un borrador o genera uno con IA");
        return;
      }
      setImproveBusy(mode);
      try {
        const { data, error } = await supabase.functions.invoke<{
          improvedHtml?: string;
          error?: string;
          message?: string;
        }>("email-ai-improve", {
          body: {
            bodyHtml: currentHtml,
            mode,
            subject: subject.trim(),
            to: to.trim(),
            locale: "es",
          },
        });
        if (error) throw new Error(await extractFnError(error, "Error al mejorar con IA"));
        if (!data || data.error) {
          throw new Error(data?.message || data?.error || "Sin sugerencia");
        }
        const next = (data.improvedHtml || "").trim();
        if (!next) throw new Error("La IA no devolvió HTML");
        editorRef.current?.setHtml(next);
        bodyRef.current = next;
        setHasAiDraft(true);
        toast.success(
          mode === "shorter"
            ? "Versión más corta lista"
            : mode === "formal"
              ? "Versión más formal lista"
              : mode === "friendly"
                ? "Versión más amigable lista"
                : "Borrador mejorado",
        );
      } catch (e) {
        const msg = await extractFnError(e, "Error mejorando con IA");
        toast.error(msg);
      } finally {
        setImproveBusy(null);
      }
    },
    [subject, to],
  );

  const runSuggestSubject = useCallback(async () => {
    const bodyHtml = (bodyRef.current || "").trim();
    const bodyText = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!bodyText) {
      toast.error("Escribe primero un borrador para que Kawiil sugiera un asunto.");
      return;
    }
    setSubjectSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-email-draft", {
        body: {
          action: "draft",
          tone: "formal",
          context: { subject: subject.trim(), to: to.trim() },
          instruction:
            "Sugiere SOLO un asunto breve (máximo 70 caracteres) y profesional para este correo. Devuelve únicamente el asunto, sin comillas, sin la palabra 'Asunto:'. Cuerpo del correo:\n\n" +
            bodyText.slice(0, 2000),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.message === "string" ? data.message : data.error);
      const raw = (data?.text ?? "").trim();
      if (!raw) throw new Error("La IA no devolvió un asunto");
      const firstLine = raw.split("\n")[0].replace(/^["'`]+|["'`]+$/g, "").replace(/^Asunto:\s*/i, "").slice(0, 90);
      setSubject(firstLine);
      toast.success("Asunto sugerido por Kawiil AI");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo sugerir un asunto");
    } finally {
      setSubjectSuggesting(false);
    }
  }, [subject, to]);

  const applyAccountingTemplate = useCallback(
    (result: AccountingTemplatePickerApplied) => {
      setSubject(result.subject);
      editorRef.current?.setHtml(result.bodyHtml);
      bodyRef.current = result.bodyHtml;
      signatureAppliedRef.current = true;
      setAppliedTemplateInfo((prev) => ({
        ...prev,
        templateCategory: result.template.category ?? undefined,
      }));
    },
    [],
  );

  const iaToolbarButton = (
    <div className="flex items-center gap-1">
      {showAccountingTemplates ? (
        <TemplatePickerBoundary>
          <AccountingTemplatePicker
            onApply={applyAccountingTemplate}
            defaults={defaultTemplateContext as Record<string, string> | undefined}
            onClientSelected={(client) => {
              if (!to.trim() && client.email) setTo(client.email);
              setAppliedTemplateInfo((prev) => ({
                ...prev,
                clientId: client.id,
                clientName: client.name,
              }));
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

  const bodyTextLen = (bodyRef.current || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const bodyEmpty = bodyTextLen === 0;

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Nuevo mensaje"
      className="fixed bottom-0 right-3 sm:right-6 z-[120] flex max-h-[min(88vh,42rem)] w-[min(100vw-1.5rem,32rem)] flex-col overflow-hidden rounded-t-xl border border-border/70 bg-background shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onOpenChange(false); }
      }}
    >
        <header className="shrink-0 flex items-center justify-between gap-3 border-b border-border/70 px-4 sm:px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Pencil className="h-3.5 w-3.5" />
            </span>
            <p className="truncate text-sm font-semibold text-foreground">Nuevo mensaje</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-8 gap-1.5 px-2.5 text-xs",
                aiPanelOpen ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setAiPanelOpen((v) => !v)}
              title="Abrir asistente Kawiil para redactar"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {aiPanelOpen ? "Cerrar IA" : "Asistente"}
            </Button>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3.5 sm:px-5"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSend();
            }
          }}
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="compose-to" className="w-12 text-right text-sm text-muted-foreground shrink-0">
                  Para
                </Label>
                <ComposeRecipientInput
                  id="compose-to"
                  value={to}
                  onChange={setTo}
                  placeholder="destinatario@ejemplo.com, otro@ejemplo.com"
                  orgUsers={orgUsers}
                  mailContacts={mailContacts}
                  teamEmailLowerSet={teamEmailLowerSet}
                />
                {isConnected ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={syncDirectoryPending}
                    title="Actualizar directorio desde tu buzón Microsoft (recientes)"
                    onClick={() => syncDirectoryMutate({ silent: false })}
                  >
                    {syncDirectoryPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <BookUser className="h-4 w-4" />
                    )}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground shrink-0"
                  onClick={() => {
                    setShowCc((prev) => {
                      if (prev) setShowBcc(false);
                      return !prev;
                    });
                  }}
                >
                  CC {showCc ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
                </Button>
              </div>
              {showCc && (
                <div className="space-y-2 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="compose-cc" className="w-12 text-right text-sm text-muted-foreground shrink-0">
                      CC
                    </Label>
                    <ComposeRecipientInput
                      id="compose-cc"
                      value={cc}
                      onChange={setCc}
                      placeholder="copia@ejemplo.com"
                      orgUsers={orgUsers}
                      mailContacts={mailContacts}
                      teamEmailLowerSet={teamEmailLowerSet}
                    />
                    <div className="flex items-center gap-2 shrink-0 px-1">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">BCC</span>
                      <Switch checked={showBcc} onCheckedChange={setShowBcc} aria-label="Mostrar BCC" />
                    </div>
                  </div>
                  {showBcc && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="compose-bcc" className="w-12 text-right text-sm text-muted-foreground shrink-0">
                        BCC
                      </Label>
                      <ComposeRecipientInput
                        id="compose-bcc"
                        value={bcc}
                        onChange={setBcc}
                        placeholder="copia oculta@ejemplo.com"
                        orgUsers={orgUsers}
                        mailContacts={mailContacts}
                        teamEmailLowerSet={teamEmailLowerSet}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="compose-subject" className="w-12 text-right text-sm text-muted-foreground shrink-0">
                Asunto
              </Label>
              <Input
                id="compose-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Asunto del correo"
                className="flex-1"
              />
            </div>

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
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Generar borrador
                    </Button>
                    <span className="text-[10.5px] text-muted-foreground">
                      También puedes elegir una plantilla y se generará al instante.
                    </span>
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
                    Borrador generado por Kawiil AI basado en tu estilo de respuesta
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

              <RichTextEditor
                key={editorKey}
                ref={editorRef}
                initialHtml={initialBodyHtml}
                placeholder="Escribe tu mensaje..."
                onHtmlChange={(html) => {
                  bodyRef.current = html;
                }}
                className="min-h-[180px] sm:min-h-[200px]"
                toolbarEndSlot={iaToolbarButton}
              />

              <div className="space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Adjuntos (documentos, imágenes, zip…).{" "}
                    {(() => {
                      const s = composeSignature;
                      if (!s) return "Cargando origen de la firma…";
                      if (!s.html) return "Conecta Microsoft para añadir firma al redactar.";
                      if (s.source === "kawiil_profile") {
                        return "La firma es la que guardaste en la sección de arriba (Correo).";
                      }
                      if (s.source === "inferred_from_sent") {
                        return s.confidence === "low"
                          ? "La firma se aproxima con tus enviados; revisa o pégala en «Firma de correo»."
                          : "La firma se aproxima según Enviados (imágenes embebidas pueden faltar).";
                      }
                      if (s.source === "microsoft_profile") {
                        return "La firma se genera con tu perfil M365; para la misma que en Outlook, pégala en «Firma de correo».";
                      }
                      return "Se añade firma al abrir el redactor.";
                    })()}
                  </span>
                  <label className="inline-flex items-center gap-2 shrink-0">
                    <Switch checked={keepZips} onCheckedChange={setKeepZips} />
                    <span className="text-xs">Mantener .zip</span>
                  </label>
                </div>
                <FileDropzone
                  files={pendingFiles}
                  onChange={setPendingFiles}
                  limits={withLimits(emailLimits, {
                    accept: EMAIL_ATTACHMENT_ACCEPT,
                    zipMode: keepZips ? "keep" : "auto",
                  })}
                  variant="area"
                  hint="Arrastra archivos o haz click"
                  subhint={keepZips ? "Los .zip se envían tal cual" : "Los .zip se expanden y se envían como archivos"}
                  showSize
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5 sm:px-6">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-muted-foreground shrink-0">
            Cancelar
          </Button>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Más opciones: IA (sugerir asunto / mejorar) + acuses, sin saturar la barra */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  title="Más opciones"
                  aria-label="Más opciones"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Asistente IA
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={subjectSuggesting || bodyEmpty}
                  onSelect={(e) => { e.preventDefault(); void runSuggestSubject(); }}
                >
                  {subjectSuggesting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Wand className="mr-2 h-3.5 w-3.5 text-muted-foreground" />}
                  Sugerir asunto
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!!improveBusy || aiLoading}
                  onSelect={(e) => { e.preventDefault(); void runImproveBody("improve"); }}
                >
                  {improveBusy === "improve" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-2 h-3.5 w-3.5 text-muted-foreground" />}
                  Mejorar redacción
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Confirmación
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={requestReadReceipt}
                  onCheckedChange={setRequestReadReceipt}
                  onSelect={(e) => e.preventDefault()}
                >
                  Acuse de lectura
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={requestDeliveryReceipt}
                  onCheckedChange={setRequestDeliveryReceipt}
                  onSelect={(e) => e.preventDefault()}
                >
                  Acuse de entrega
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center">
              <Button
                onClick={() => void handleSend()}
                disabled={sendEmail.isPending || !to.trim()}
                size="sm"
                className="rounded-r-none"
              >
                {sendEmail.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                Enviar
              </Button>
              <DropdownMenu open={schedulePickerOpen} onOpenChange={setSchedulePickerOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    className="rounded-l-none border-l border-primary-foreground/20 px-2"
                    disabled={sendEmail.isPending || !to.trim()}
                    aria-label="Programar envío"
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {[
                    { label: "Esta tarde (17:00)", hours: 17, today: true },
                    { label: "Mañana por la mañana (09:00)", hours: 9, today: false },
                    { label: "Mañana al mediodía (13:00)", hours: 13, today: false },
                  ].map(opt => {
                    const d = new Date();
                    if (!opt.today) d.setDate(d.getDate() + 1);
                    d.setHours(opt.hours, 0, 0, 0);
                    return (
                      <DropdownMenuItem key={opt.label} onClick={() => { setSchedulePickerOpen(false); void handleScheduleSend(d); }}>
                        <CalendarClock className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        {opt.label}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuItem
                    onClick={() => {
                      setSchedulePickerOpen(false);
                      const input = window.prompt("Fecha y hora de envío (ej. 2026-06-05 09:00):");
                      if (!input) return;
                      const d = new Date(input);
                      if (isNaN(d.getTime())) { toast.error("Fecha inválida"); return; }
                      void handleScheduleSend(d);
                    }}
                  >
                    <CalendarClock className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    Otra fecha y hora…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
    </div>,
    document.body,
  );
}
