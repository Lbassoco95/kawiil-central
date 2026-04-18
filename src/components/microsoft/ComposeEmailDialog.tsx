import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Loader2, Send, ChevronDown, ChevronUp, Sparkles, RefreshCw, Paperclip, X, BookUser } from "lucide-react";
import { toast } from "sonner";
import {
  filesToComposerAttachments,
  parseRecipients,
  validateRecipientGroups,
  type ComposerAttachment,
} from "@/lib/emailComposer";
import { AccountingTemplatePicker } from "@/components/accounting/AccountingTemplatePicker";

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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setAttachments([]);
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

  const handleAttachmentPick = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const parsed = await filesToComposerAttachments(files);
      setAttachments((prev) => {
        const merged = [...prev];
        for (const item of parsed) {
          if (!merged.some((existing) => existing.name === item.name && existing.size === item.size)) {
            merged.push(item);
          }
        }
        return merged;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron adjuntar archivos");
    }
  };

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
      <DialogContent className="flex max-h-[92vh] w-[min(100vw-1.5rem,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 text-left sm:px-6">
          <DialogTitle>Nuevo correo</DialogTitle>
        </DialogHeader>
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
                <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 shadow-sm shrink-0">
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
                      className="gap-1.5"
                    >
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : null}
                      Generar
                    </Button>
                    {hasAiDraft && lastInstructionRef.current ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={aiLoading}
                        onClick={() => void runAiDraft(lastInstructionRef.current)}
                        className="gap-1"
                      >
                        {aiLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Regenerar
                      </Button>
                    ) : null}
                  </div>
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

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.msg,.eml"
                onChange={(e) => void handleAttachmentPick(e.target.files)}
              />
              <div
                className="rounded-md border border-dashed p-3 text-sm text-muted-foreground shrink-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleAttachmentPick(e.dataTransfer.files);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs">
                    Adjuntos (documentos, imágenes, zip…). La firma del nuevo correo usa tu perfil de Microsoft 365.
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="h-3.5 w-3.5 mr-1" />
                    Adjuntar
                  </Button>
                </div>
                {attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                      >
                        <span className="max-w-[180px] truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) =>
                              prev.filter((f) => !(f.name === file.name && f.size === file.size))
                            )
                          }
                          aria-label={`Quitar ${file.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
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
      </DialogContent>
    </Dialog>
  );
}
