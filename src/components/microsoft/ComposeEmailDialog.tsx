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
import { useSendNewEmail } from "@/hooks/useMicrosoft";
import { useOrgUsers, type OrgUser } from "@/hooks/useOrgUsers";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Send, ChevronDown, ChevronUp, Sparkles, RefreshCw, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import {
  filesToComposerAttachments,
  parseRecipients,
  validateRecipientGroups,
  type ComposerAttachment,
} from "@/lib/emailComposer";

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  id?: string;
  orgUsers: OrgUser[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const parts = value.split(",");
  const lastQuery = (parts[parts.length - 1] ?? "").trim().toLowerCase();

  const suggestions = useMemo(
    () =>
      orgUsers.map((u) => ({
        user_id: u.user_id,
        email: u.email || "",
        full_name: u.full_name || u.email || "",
      })).filter((u) => u.email),
    [orgUsers]
  );

  const filtered = useMemo(() => {
    if (!lastQuery) return [];
    return suggestions
      .filter(
        (u) =>
          u.email.toLowerCase().includes(lastQuery) ||
          u.full_name.toLowerCase().includes(lastQuery)
      )
      .slice(0, 8);
  }, [suggestions, lastQuery]);

  const showList = menuOpen && filtered.length > 0 && lastQuery.length >= 1;

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
        <div className="absolute z-50 top-full mt-1 w-full max-h-40 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {filtered.map((u) => (
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
      )}
    </div>
  );
}

export function ComposeEmailDialog({ open, onOpenChange }: ComposeEmailDialogProps) {
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
  const sendEmail = useSendNewEmail();
  const { data: orgUsers = [] } = useOrgUsers();

  useEffect(() => {
    if (open) {
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
  }, [open]);

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

  const iaToolbarButton = (
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
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo correo</DialogTitle>
        </DialogHeader>
        <div
          className="space-y-3 px-0"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSend();
            }
          }}
        >
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
              />
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

          <div className="space-y-2">
            {aiPanelOpen && (
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 shadow-sm">
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
              placeholder="Escribe tu mensaje..."
              onHtmlChange={(html) => {
                bodyRef.current = html;
              }}
              className="min-h-[200px]"
              toolbarEndSlot={iaToolbarButton}
            />

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleAttachmentPick(e.target.files)}
            />
            <div
              className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleAttachmentPick(e.dataTransfer.files);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs">Adjuntos (arrastra aquí o usa el botón)</span>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-3.5 w-3.5 mr-1" />
                  Adjuntar
                </Button>
              </div>
              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
                      <span className="max-w-[180px] truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((f) => !(f.name === file.name && f.size === file.size)))}
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

          <div className="flex justify-end gap-2 pt-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
