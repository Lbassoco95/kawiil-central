import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { emailLimits, withLimits } from "@/lib/fileIntake/limits";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/microsoft/RichTextEditor";
import { useSendNewEmail, useOutlookComposeSignature, useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useOrgUsers, type OrgUser } from "@/hooks/useOrgUsers";
import { useMailDirectoryContacts, useSyncMailDirectory, type MailDirectoryContact } from "@/hooks/useMailDirectory";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Send, ChevronDown, ChevronUp, Sparkles, RefreshCw, BookUser, Pencil, X, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  filesToComposerAttachments,
  parseRecipients,
  validateRecipientGroups,
  type ComposerAttachment,
} from "@/lib/emailComposer";
import { AccountingTemplatePicker } from "@/components/accounting/AccountingTemplatePicker";

const KAWIIL_AI_GRADIENT = "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";
const KAWIIL_AI_HEADER_BG =
  "linear-gradient(135deg, hsl(220 100% 55%) 0%, hsl(210 100% 45%) 100%)";

type ImproveMode = "improve" | "shorter" | "formal" | "friendly";

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
}

function plainTextToEmailHtml(text: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const t = text.trim();
  if (!t) return "<p></p>";
  const blocks = t.split(/\n\n+/);
  return blocks.map((b) => `<p>${esc(b).replace(/\n/g, "<br/>")}</p>`).join("");
}

function ComposeRecipientInput({
  value,
  onChange,
  placeholder,
  id,
  orgUsers,
  mailContacts,
  teamEmailLowerSet,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  id?: string;
  orgUsers: OrgUser[];
  mailContacts: MailDirectoryContact[];
  teamEmailLowerSet: Set<string>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const parts = value.split(",");
  const lastQuery = (parts[parts.length - 1] ?? "").trim().toLowerCase();

  const teamSuggestions = useMemo(
    () =>
      orgUsers
        .map((u) => ({
          user_id: u.user_id,
          email: u.email || "",
          full_name: u.full_name || u.email || "",
        }))
        .filter((u) => u.email),
    [orgUsers]
  );

  const filteredTeam = useMemo(() => {
    if (!lastQuery) return [];
    return teamSuggestions
      .filter(
        (u) =>
          u.email.toLowerCase().includes(lastQuery) || u.full_name.toLowerCase().includes(lastQuery)
      )
      .slice(0, 8);
  }, [teamSuggestions, lastQuery]);

  const filteredMailbox = useMemo(() => {
    if (!lastQuery) return [];
    return mailContacts
      .filter((c) => {
        if (teamEmailLowerSet.has(c.email.toLowerCase())) return false;
        const name = (c.display_name || "").toLowerCase();
        return c.email.includes(lastQuery) || name.includes(lastQuery);
      })
      .slice(0, 8);
  }, [mailContacts, lastQuery, teamEmailLowerSet]);

  const showList =
    menuOpen && lastQuery.length >= 1 && (filteredTeam.length > 0 || filteredMailbox.length > 0);

  const pick = (email: string) => {
    const before = parts.slice(0, -1).join(",").trim();
    const next = before ? `${before}, ${email}` : email;
    onChange(next);
    setMenuOpen(false);
  };

  return (
    <div className="relative flex-1 min-w-0">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        onFocus={() => setMenuOpen(true)}
        onBlur={() => setTimeout(() => setMenuOpen(false), 200)}
      />
      {showList && (
        <div className="absolute z-50 top-full mt-1 w-full max-h-52 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {filteredTeam.length > 0 ? (
            <div className="py-1">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Equipo
              </div>
              {filteredTeam.map((u) => (
                <button
                  key={u.user_id}
                  type="button"
                  className="flex w-full flex-col gap-0 px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(u.email)}
                >
                  <span className="font-medium truncate">{u.full_name}</span>
                  <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                </button>
              ))}
            </div>
          ) : null}
          {filteredMailbox.length > 0 ? (
            <div className={`py-1 ${filteredTeam.length > 0 ? "border-t border-border" : ""}`}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Buzón
              </div>
              {filteredMailbox.map((c) => (
                <button
                  key={c.email}
                  type="button"
                  className="flex w-full flex-col gap-0 px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.email)}
                >
                  <span className="font-medium truncate">{c.display_name || c.email}</span>
                  <span className="text-xs text-muted-foreground truncate">{c.email}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  initialTo,
  initialSubject,
  initialBodyHtml,
  defaultTemplateContext,
  showAccountingTemplates = true,
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [keepZips, setKeepZips] = useState(true);
  const lastInstructionRef = useRef("");
  const bodyRef = useRef("");
  const editorRef = useRef<RichTextEditorHandle>(null);
  const signatureAppliedRef = useRef(false);
  const directorySyncRef = useRef(false);
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
      if (initialTo) setTo(initialTo);
      if (initialSubject) setSubject(initialSubject);
      if (initialBodyHtml) {
        bodyRef.current = initialBodyHtml;
        signatureAppliedRef.current = true;
      }
      setEditorKey((k) => k + 1);
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

  /** Firma desde perfil Microsoft (/me); Graph no expone la firma HTML de Outlook de forma oficial. */
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
      const html = `${composeSignature.html}<p><br></p>`;
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
      if (error) throw error;
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
      toast.error(e instanceof Error ? e.message : "Error al generar borrador");
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
    });

    onOpenChange(false);
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
        if (error) throw new Error(error.message || "Error AI");
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
        toast.error(e instanceof Error ? e.message : "Error mejorando con IA");
      } finally {
        setImproveBusy(null);
      }
    },
    [subject, to],
  );

  const applyAccountingTemplate = useCallback(
    (result: { subject: string; bodyHtml: string }) => {
      setSubject(result.subject);
      editorRef.current?.setHtml(result.bodyHtml);
      bodyRef.current = result.bodyHtml;
      signatureAppliedRef.current = true;
    },
    [],
  );

  const iaToolbarButton = (
    <div className="flex items-center gap-1">
      {showAccountingTemplates ? (
        <AccountingTemplatePicker
          onApply={applyAccountingTemplate}
          defaults={defaultTemplateContext as Record<string, string> | undefined}
          onClientSelected={(client) => {
            if (!to.trim() && client.email) setTo(client.email);
          }}
        />
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[min(100vw-1.5rem,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl rounded-2xl border-sky-200/40 dark:border-sky-900/40 [&>button.absolute]:hidden"
      >
        <header
          className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-white"
          style={{ background: KAWIIL_AI_HEADER_BG }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
              <Pencil className="h-3.5 w-3.5" />
            </span>
            <p className="truncate text-sm font-semibold">Nuevo mensaje</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-white/90 hover:bg-white/15"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6"
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
                <div className="rounded-xl border border-sky-200/60 bg-gradient-to-r from-sky-50 to-blue-50 p-3 space-y-2 shadow-sm shrink-0 dark:border-sky-800/40 dark:from-sky-950/30 dark:to-blue-950/20">
                  <Input
                    placeholder="¿Qué quieres decir? Ej: confirma la reunión del martes"
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={aiLoading}
                      onClick={() => void runAiDraft(aiInstruction)}
                      className="gap-1.5 text-white shadow-sm"
                      style={{ background: KAWIIL_AI_GRADIENT }}
                    >
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Generar borrador
                    </Button>
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
                className="min-h-[min(40vh,360px)] sm:min-h-[320px]"
                toolbarEndSlot={iaToolbarButton}
              />

              <div className="space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Adjuntos (documentos, imágenes, zip…). La firma del nuevo correo usa tu perfil de Microsoft 365.</span>
                  <label className="inline-flex items-center gap-2 shrink-0">
                    <Switch checked={keepZips} onCheckedChange={setKeepZips} />
                    <span className="text-xs">Mantener .zip</span>
                  </label>
                </div>
                <FileDropzone
                  files={pendingFiles}
                  onChange={setPendingFiles}
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
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-6">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-muted-foreground">
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1.5 text-white shadow-sm hover:opacity-90 disabled:opacity-60"
              style={{ background: KAWIIL_AI_GRADIENT }}
              disabled={!!improveBusy || aiLoading}
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
            <Button onClick={() => void handleSend()} disabled={sendEmail.isPending || !to.trim()}>
              {sendEmail.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1.5" />
              )}
              Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
