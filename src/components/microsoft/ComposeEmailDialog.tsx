import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { emailLimits, withLimits } from "@/lib/fileIntake/limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/microsoft/RichTextEditor";
import { useSendNewEmail, useOutlookComposeSignature, useMicrosoftConnection, useCreateReplyDraft, useSendDraft } from "@/hooks/useMicrosoft";
import type { SentAccountingEmailInfo } from "@/lib/accountingEmailStepSync";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useMailDirectoryContacts, useSyncMailDirectory } from "@/hooks/useMailDirectory";
import { ComposeRecipientInput } from "@/components/microsoft/ComposeRecipientInput";
import { useLinkedAccounts, useSendLinkedOutlookEmail, useSendLinkedGmailEmail } from "@/hooks/useLinkedAccounts";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/functions-js";
import {
  Loader2,
  Send,
  ChevronUp,
  Sparkles,
  BookUser,
  Pencil,
  X,
  Wand2,
  Wand,
  CalendarClock,
  MoreHorizontal,
  Minus,
  Maximize2,
  Minimize2,
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
  /** Periodo contable exacto cuando el correo se compone desde un periodo. */
  periodId?: string;
  [key: string]: string | undefined;
}

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill values for the recipient, subject, and body. */
  initialTo?: string;
  initialCc?: string;
  initialSubject?: string;
  initialBodyHtml?: string;
  /**
   * Si es una respuesta a un correo de la cuenta principal, el envío se hace como respuesta de
   * Graph (hereda el conversationId → se engancha al hilo), manteniendo el cuerpo limpio que
   * escribió el usuario. Sin esto, se envía como correo nuevo.
   */
  replyContext?: { messageId: string; replyAll?: boolean } | null;
  /** Archivos precargados (p. ej. adjuntos del correo reenviado). */
  initialFiles?: File[];
  /** Valores precargados para el selector de plantillas contables. */
  defaultTemplateContext?: ComposeDefaultTemplateContext;
  /** Muestra el selector de plantillas del área contable. Por defecto true. */
  showAccountingTemplates?: boolean;
  /**
   * Se dispara después de CADA envío exitoso (cuenta principal, cuentas
   * vinculadas y respuesta enganchada al hilo) cuando se aplicó una plantilla
   * contable. Sirve para cerrar el paso del periodo — ver el contrato en
   * `src/lib/accountingEmailStepSync.ts`.
   */
  onAfterSend?: (info: SentAccountingEmailInfo) => void;
}

/** Firma limpia (nombre + correo) para cuentas vinculadas, cuando no hay firma guardada de esa cuenta. */
function buildSimpleSignatureHtml(name: string, email: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const n = (name || "").trim();
  const e = (email || "").trim();
  if (!n && !e) return "";
  let html = `<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#333;">`;
  if (n && n.toLowerCase() !== e.toLowerCase()) html += `<strong>${esc(n)}</strong><br/>`;
  if (e) html += `<a href="mailto:${esc(e)}">${esc(e)}</a>`;
  html += `</p>`;
  return html;
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  initialTo,
  initialCc,
  initialSubject,
  initialBodyHtml,
  replyContext,
  initialFiles,
  defaultTemplateContext,
  showAccountingTemplates = true,
  onAfterSend,
}: ComposeEmailDialogProps) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
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
  const [customSched, setCustomSched] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [appliedTemplateInfo, setAppliedTemplateInfo] = useState<SentAccountingEmailInfo | null>(null);
  const lastInstructionRef = useRef("");
  const bodyRef = useRef("");
  const editorRef = useRef<RichTextEditorHandle>(null);
  const signatureAppliedRef = useRef(false);
  const lastAppliedSigRef = useRef("");
  const directorySyncRef = useRef(false);
  const { user } = useAuth();
  const sendEmail = useSendNewEmail();
  const createReplyDraft = useCreateReplyDraft();
  const sendReplyDraft = useSendDraft();
  const { data: orgUsers = [] } = useOrgUsers();
  const { isConnected, profile } = useMicrosoftConnection();
  const { data: mailContacts = [] } = useMailDirectoryContacts(open && isConnected);
  const { mutate: syncDirectoryMutate, isPending: syncDirectoryPending } = useSyncMailDirectory();
  const { data: composeSignature } = useOutlookComposeSignature(open);
  const { data: linkedAccounts = [] } = useLinkedAccounts();
  const sendLinkedOutlook = useSendLinkedOutlookEmail();
  const sendLinkedGmail = useSendLinkedGmailEmail();

  // Identidades desde las que se puede enviar ("De"): principal Kawiil + cuentas vinculadas con correo.
  type SenderOption = { key: string; email: string; label: string; kind: "primary" | "outlook" | "gmail"; accountId?: string };
  const senderOptions = useMemo<SenderOption[]>(() => {
    const primEmail = ((profile?.mail || profile?.userPrincipalName || "") as string).trim();
    const opts: SenderOption[] = [
      { key: "primary", email: primEmail, label: primEmail || "Cuenta Kawiil", kind: "primary" },
    ];
    for (const a of linkedAccounts) {
      if (!a.mail_enabled || a.status !== "connected" || !a.email) continue;
      if (a.provider === "microsoft") opts.push({ key: `outlook:${a.id}`, email: a.email, label: a.email, kind: "outlook", accountId: a.id });
      else if (a.provider === "google") opts.push({ key: `gmail:${a.id}`, email: a.email, label: a.email, kind: "gmail", accountId: a.id });
    }
    return opts;
  }, [profile, linkedAccounts]);
  const [fromKey, setFromKey] = useState("primary");
  const [fromMenuOpen, setFromMenuOpen] = useState(false);
  const fromOption = senderOptions.find((o) => o.key === fromKey) ?? senderOptions[0];
  // Firma según la cuenta "De" seleccionada: la principal usa su firma guardada; las vinculadas
  // una firma limpia con su nombre + correo.
  const signatureHtmlForAccount = useMemo(() => {
    if (!fromOption || fromOption.kind === "primary") {
      return composeSignature?.html ? sanitizeSignatureHtml(composeSignature.html) : "";
    }
    const acc = linkedAccounts.find((a) => a.id === fromOption.accountId);
    return buildSimpleSignatureHtml(acc?.display_name || fromOption.email, fromOption.email);
  }, [fromOption, composeSignature, linkedAccounts]);

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
      lastAppliedSigRef.current = "";
      setMinimized(false);
      setExpanded(false);
      setFromKey("primary");
      setFromMenuOpen(false);
      setCustomSched("");
      setRequestDeliveryReceipt(false);
      setRequestReadReceipt(false);
      if (initialTo) setTo(initialTo);
      if (initialCc) { setCc(initialCc); setShowCc(true); }
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

  // Adjuntos precargados (p. ej. archivos del correo reenviado): se cargan a la lista de adjuntos
  // cuando llegan (la descarga es asíncrona), para que se envíen con el correo.
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      setPendingFiles(initialFiles);
    }
  }, [open, initialFiles]);

  useEffect(() => {
    if (!open) {
      directorySyncRef.current = false;
      return;
    }
    if (!isConnected || directorySyncRef.current) return;
    directorySyncRef.current = true;
    syncDirectoryMutate({ silent: true });
  }, [open, isConnected, syncDirectoryMutate]);

  /**
   * Coloca/actualiza la firma según la cuenta "De" seleccionada. Se reemplaza SOLO si el usuario
   * no ha escrito contenido propio (el cuerpo está vacío o contiene exactamente la firma anterior),
   * para no pisar lo que ya redactó. Reacciona al cambio de cuenta (fromKey).
   */
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const strip = (s: string) => (s || "").replace(/<[^>]+>/g, " ").replace(/\s|&nbsp;/gi, "").trim();
      const bodyText = strip(bodyRef.current);
      const lastSigText = strip(lastAppliedSigRef.current);
      const safeToReplace = bodyText.length === 0 || bodyText === lastSigText;
      if (!safeToReplace) return;
      const sig = signatureHtmlForAccount;
      const html = sig ? `${sig}<p><br></p>` : "<p><br></p>";
      editorRef.current?.setHtml(html);
      bodyRef.current = html;
      lastAppliedSigRef.current = sig ? html : "";
      signatureAppliedRef.current = true;
    }, 150);
    return () => window.clearTimeout(t);
  }, [open, editorKey, fromKey, signatureHtmlForAccount]);

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
      const existing = (bodyRef.current || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (existing.length > 0 && !window.confirm("Ya tienes contenido escrito. ¿Reemplazarlo con el borrador de la IA?")) {
        return;
      }
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

  /**
   * Aviso de "se envió un correo con plantilla contable" → cierra el paso del
   * periodo. DEBE llamarse en TODAS las rutas de envío exitosas: cuenta
   * principal, cuentas vinculadas (Outlook/Gmail) y respuesta enganchada al
   * hilo. Si agregas otra ruta de envío, llámalo ahí también
   * (ver `src/lib/accountingEmailStepSync.ts`).
   */
  const emitAfterSend = useCallback(
    (recipients: string[], attachmentNames: string[]) => {
      const info = appliedTemplateInfo;
      if (!info?.templateCategory || !onAfterSend) return;
      onAfterSend({
        ...info,
        clientId: info.clientId ?? defaultTemplateContext?.clientId ?? null,
        clientName: info.clientName ?? defaultTemplateContext?.razon_social ?? null,
        projectId: info.projectId ?? defaultTemplateContext?.projectId ?? null,
        periodId: info.periodId ?? defaultTemplateContext?.periodId ?? null,
        subject: subject || null,
        recipients,
        attachmentNames,
        sentAt: new Date().toISOString(),
      });
      setAppliedTemplateInfo(null);
    },
    [appliedTemplateInfo, onAfterSend, defaultTemplateContext, subject],
  );

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
    const attachmentNames = pendingFiles.map((f) => f.name);

    // Envío desde una cuenta VINCULADA (Outlook/Gmail) elegida en "De": se envía por esa cuenta
    // (send-as), no por la principal. Los adjuntos aún no se soportan por esta vía.
    if (fromOption && fromOption.kind !== "primary" && fromOption.accountId) {
      const linkedAttachments = attachments.map((a) => ({ name: a.name, contentType: a.contentType, contentBytes: a.contentBytes }));
      try {
        if (fromOption.kind === "outlook") {
          await sendLinkedOutlook.mutateAsync({
            accountId: fromOption.accountId,
            to: toList,
            cc: ccList.length ? ccList : undefined,
            bcc: bccList.length ? bccList : undefined,
            subject: subject || "(Sin asunto)",
            bodyHtml: bodyRef.current || "<p></p>",
            attachments: linkedAttachments.length ? linkedAttachments : undefined,
          });
        } else {
          if (bccList.length) toast.info("Gmail vinculado no admite CCO; se omitió esa copia oculta.");
          await sendLinkedGmail.mutateAsync({
            accountId: fromOption.accountId,
            to: toList,
            cc: ccList.length ? ccList : undefined,
            subject: subject || "(Sin asunto)",
            bodyHtml: bodyRef.current || "<p></p>",
            attachments: linkedAttachments.length ? linkedAttachments : undefined,
          });
        }
        toast.success(`Enviado desde ${fromOption.email}`);
        emitAfterSend(toList, attachmentNames);
        onOpenChange(false);
        return;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo enviar desde esa cuenta");
        return;
      }
    }

    // Respuesta enganchada al hilo: creamos el borrador de respuesta (hereda el conversationId del
    // original) y lo enviamos con NUESTRO cuerpo limpio. Así se engancha visualmente al hilo sin
    // ensuciar la redacción. Si algo falla, caemos al envío como correo nuevo.
    if (replyContext?.messageId) {
      try {
        const draft = (await createReplyDraft.mutateAsync({
          messageId: replyContext.messageId,
          replyAll: replyContext.replyAll,
        })) as { id?: string; unsupported?: boolean } | null;
        if (draft?.id && !draft.unsupported) {
          await sendReplyDraft.mutateAsync({
            draftId: draft.id,
            body: { contentType: "HTML", content: bodyRef.current || "<p></p>" },
            attachments,
            toRecipients: toList.map((e) => ({ emailAddress: { address: e } })),
            ccRecipients: ccList.map((e) => ({ emailAddress: { address: e } })),
            bccRecipients: bccList.map((e) => ({ emailAddress: { address: e } })),
            requestDeliveryReceipt,
            requestReadReceipt,
          });
          emitAfterSend(toList, attachmentNames);
          onOpenChange(false);
          return;
        }
      } catch (err) {
        console.warn("[compose] respuesta en hilo falló; se envía como correo nuevo", err);
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

    emitAfterSend(toList, attachmentNames);
    onOpenChange(false);
  };

  /**
   * Envío programado: NO dispara `emitAfterSend` a propósito — el correo aún no
   * sale, así que el paso del periodo no debe cerrarse hasta que el job lo
   * envíe.
   */
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
  const sending = sendEmail.isPending || createReplyDraft.isPending || sendReplyDraft.isPending || sendLinkedOutlook.isPending || sendLinkedGmail.isPending;

  if (!open || typeof document === "undefined") return null;

  // Minimizado: barra compacta abajo a la derecha para leer el correo detrás.
  if (minimized) {
    return createPortal(
      <div className="fixed bottom-0 right-3 sm:right-6 z-[120] flex w-72 max-w-[calc(100vw-1.5rem)] items-center justify-between gap-2 rounded-t-xl border border-border/70 bg-background px-3 py-2.5 shadow-2xl">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => setMinimized(false)}
          title="Restaurar"
        >
          <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-[13px] font-semibold text-foreground">
            {subject?.trim() || "Nuevo mensaje"}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setMinimized(false)}
            aria-label="Restaurar"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-[119] bg-black/30 animate-in fade-in-0 duration-150"
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        role="dialog"
        aria-modal={expanded ? "true" : "false"}
        aria-label="Nuevo mensaje"
        className={cn(
          "fixed z-[120] flex flex-col overflow-hidden border border-border/70 bg-background shadow-2xl animate-in duration-200",
          expanded
            ? "left-1/2 top-1/2 h-[calc(100dvh-3rem)] w-[min(100vw-3rem,56rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl fade-in-0 zoom-in-95"
            : "bottom-0 right-3 sm:right-6 h-[36rem] max-h-[calc(100dvh-1.5rem)] w-[min(100vw-1.5rem,32rem)] rounded-t-xl slide-in-from-bottom-4",
        )}
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
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Reducir" : "Pantalla completa"}
              title={expanded ? "Volver a ventana pequeña" : "Expandir a pantalla completa"}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => { setMinimized(true); setExpanded(false); }}
              aria-label="Minimizar"
              title="Minimizar para leer el correo"
            >
              <Minus className="h-4 w-4" />
            </button>
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
            {senderOptions.length > 1 && (
              <div className="flex items-center gap-2">
                <Label className="w-12 text-right text-sm text-muted-foreground shrink-0">De</Label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setFromMenuOpen((v) => !v)}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground hover:border-primary/60"
                    title="Elegir desde qué cuenta se envía"
                  >
                    <span className="max-w-[22rem] truncate">{fromOption?.email || "Cuenta Kawiil"}</span>
                    <ChevronUp className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", fromMenuOpen ? "" : "rotate-180")} />
                  </button>
                  {fromMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-[125]" onClick={() => setFromMenuOpen(false)} />
                      <div className="absolute left-0 top-full z-[130] mt-1 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-popover p-1 shadow-xl">
                        {senderOptions.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => { setFromKey(opt.key); setFromMenuOpen(false); }}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-accent",
                              opt.key === fromKey ? "text-primary font-medium" : "text-foreground",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{opt.email}</span>
                              <span className="block text-[11px] text-muted-foreground">
                                {opt.kind === "primary" ? "Cuenta Kawiil" : opt.kind === "gmail" ? "Gmail vinculado" : "Outlook vinculado"}
                              </span>
                            </span>
                            {opt.key === fromKey && <span className="text-primary">✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
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
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowCc((v) => !v)}
                    className={cn(
                      "rounded-md px-1.5 py-1 text-xs font-semibold transition-colors",
                      showCc || cc.trim() ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                    title="Con copia (Cc)"
                    aria-pressed={showCc || !!cc.trim()}
                  >
                    Cc
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBcc((v) => !v)}
                    className={cn(
                      "rounded-md px-1.5 py-1 text-xs font-semibold transition-colors",
                      showBcc || bcc.trim() ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                    title="Con copia oculta (Cco)"
                    aria-pressed={showBcc || !!bcc.trim()}
                  >
                    Cco
                  </button>
                </div>
              </div>
              {(showCc || cc.trim()) && (
                <div className="flex items-center gap-2 animate-fade-in">
                  <Label htmlFor="compose-cc" className="w-12 text-right text-sm text-muted-foreground shrink-0">
                    Cc
                  </Label>
                  <ComposeRecipientInput
                    id="compose-cc"
                    value={cc}
                    onChange={setCc}
                    placeholder="con copia@ejemplo.com"
                    orgUsers={orgUsers}
                    mailContacts={mailContacts}
                    teamEmailLowerSet={teamEmailLowerSet}
                  />
                </div>
              )}
              {(showBcc || bcc.trim()) && (
                <div className="flex items-center gap-2 animate-fade-in">
                  <Label htmlFor="compose-bcc" className="w-12 text-right text-sm text-muted-foreground shrink-0">
                    Cco
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
                disabled={sending || !to.trim()}
                size="sm"
                className="rounded-r-none"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                Enviar
              </Button>
              <div className="relative">
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  disabled={sending || !to.trim()}
                  aria-label="Programar envío"
                  title="Programar envío"
                  onClick={() => setSchedulePickerOpen((v) => !v)}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                </Button>
                {schedulePickerOpen && (
                  <>
                    <div className="fixed inset-0 z-[125]" onClick={() => setSchedulePickerOpen(false)} />
                    <div
                      className="absolute bottom-full right-0 z-[130] mb-2 w-64 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="px-2 pt-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Programar envío
                      </p>
                      {[
                        { label: "Esta tarde (17:00)", hours: 17, today: true },
                        { label: "Mañana por la mañana (09:00)", hours: 9, today: false },
                        { label: "Mañana al mediodía (13:00)", hours: 13, today: false },
                      ].map((opt) => {
                        const d = new Date();
                        if (!opt.today) d.setDate(d.getDate() + 1);
                        d.setHours(opt.hours, 0, 0, 0);
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                            onClick={() => { setSchedulePickerOpen(false); void handleScheduleSend(d); }}
                          >
                            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                            {opt.label}
                          </button>
                        );
                      })}
                      <div className="my-1.5 h-px bg-border" />
                      <p className="px-2 pb-1 text-[11px] text-muted-foreground">Otra fecha y hora</p>
                      <div className="flex flex-col gap-1.5 px-2 pb-1">
                        <input
                          type="datetime-local"
                          value={customSched}
                          onChange={(e) => setCustomSched(e.target.value)}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:border-primary"
                        />
                        <Button
                          size="sm"
                          className="h-8 w-full text-xs"
                          disabled={!customSched}
                          onClick={() => {
                            const d = new Date(customSched);
                            if (isNaN(d.getTime())) { toast.error("Fecha inválida"); return; }
                            if (d.getTime() <= Date.now()) { toast.error("Elige una fecha y hora futura"); return; }
                            setSchedulePickerOpen(false);
                            void handleScheduleSend(d);
                          }}
                        >
                          Programar
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
