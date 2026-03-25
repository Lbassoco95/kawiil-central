import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOutlookEmails, useEmailDetail, useReplyEmail, useForwardEmail, useMarkEmailRead } from "@/hooks/useMicrosoft";
import { Search, Mail, MailOpen, Paperclip, Loader2, Reply, ReplyAll, Forward, Send, ClipboardList, Sparkles, Languages, ListChecks } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CreateTaskFromEmailDialog } from "./CreateTaskFromEmailDialog";
import { EmailAIAssistant } from "./EmailAIAssistant";

type EmailAction = "reply" | "reply-all" | "forward" | null;

export function EmailView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailAction, setEmailAction] = useState<EmailAction>(null);
  const [replyText, setReplyText] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showFullAI, setShowFullAI] = useState(false);
  const [quickAIPrompt, setQuickAIPrompt] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: emails = [], isLoading } = useOutlookEmails("inbox", debouncedSearch || undefined);
  const { data: emailDetail, isLoading: detailLoading } = useEmailDetail(selectedEmailId);
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();
  const markRead = useMarkEmailRead();

  const handleOpenEmail = useCallback((email: any) => {
    setSelectedEmailId(email.id);
    resetAction();
    setQuickAIPrompt(null);
    setShowFullAI(false);
    if (!email.isRead) markRead.mutate(email.id);
  }, [markRead]);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__emailSearchTimeout);
    (window as any).__emailSearchTimeout = setTimeout(() => setDebouncedSearch(val), 500);
  };

  const handleSendReply = () => {
    if (!selectedEmailId || !replyText.trim()) return;
    if (emailAction === "forward") {
      if (!forwardTo.trim()) return;
      forwardEmail.mutate(
        { messageId: selectedEmailId, comment: replyText, toRecipients: forwardTo.split(",").map((s) => s.trim()) },
        { onSuccess: resetAction }
      );
    } else {
      replyEmail.mutate(
        { messageId: selectedEmailId, comment: replyText, replyAll: emailAction === "reply-all" },
        { onSuccess: resetAction }
      );
    }
  };

  const resetAction = () => {
    setEmailAction(null);
    setReplyText("");
    setForwardTo("");
    setShowFullAI(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!emails.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const currentIdx = emails.findIndex((em: any) => em.id === selectedEmailId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, emails.length - 1);
        handleOpenEmail(emails[next]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        handleOpenEmail(emails[prev]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [emails, selectedEmailId, handleOpenEmail]);

  const isSending = replyEmail.isPending || forwardEmail.isPending;

  return (
    <div className="flex h-[calc(100vh-180px)] border border-border rounded-lg overflow-hidden bg-background">
      {/* Left panel — email list */}
      <div className="w-[340px] lg:w-[380px] border-r border-border flex flex-col shrink-0">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar correos..."
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1" ref={listRef}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : emails.length === 0 ? (
            <div className="p-6 text-center">
              <Mail className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No se encontraron correos</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {emails.map((email: any) => (
                <div
                  key={email.id}
                  className={`px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/50 ${
                    selectedEmailId === email.id ? "bg-accent" : ""
                  } ${!email.isRead ? "bg-primary/5" : ""}`}
                  onClick={() => handleOpenEmail(email)}
                >
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5 shrink-0">
                      {email.isRead ? (
                        <MailOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Mail className="h-3.5 w-3.5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={`text-xs truncate ${!email.isRead ? "font-semibold text-foreground" : "text-foreground"}`}>
                          {email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Desconocido"}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(parseISO(email.receivedDateTime), { addSuffix: false, locale: es })}
                        </span>
                      </div>
                      <p className={`text-xs truncate ${!email.isRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {email.subject || "(sin asunto)"}
                      </p>
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                        {email.bodyPreview?.substring(0, 80)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 pt-0.5">
                      {email.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                      {email.importance === "high" && (
                        <div className="h-2 w-2 rounded-full bg-destructive" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right panel — email detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedEmailId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Mail className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Selecciona un correo para leerlo</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Usa ↑ ↓ para navegar</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : emailDetail ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-border shrink-0">
              <h2 className="text-base font-semibold text-foreground leading-tight mb-2">
                {emailDetail.subject || "(sin asunto)"}
              </h2>
              <div className="flex items-start justify-between gap-4">
                <div className="text-xs text-muted-foreground space-y-0.5 min-w-0">
                  <p className="truncate">
                    <span className="font-medium text-foreground">{emailDetail.from?.emailAddress?.name}</span>{" "}
                    &lt;{emailDetail.from?.emailAddress?.address}&gt;
                  </p>
                  <p className="truncate">
                    Para: {emailDetail.toRecipients?.map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", ")}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {emailDetail.receivedDateTime
                    ? formatDistanceToNow(parseISO(emailDetail.receivedDateTime), { addSuffix: true, locale: es })
                    : ""}
                </span>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border shrink-0 flex-wrap">
              <Button
                variant={emailAction === "reply" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setEmailAction(emailAction === "reply" ? null : "reply"); setReplyText(""); setShowFullAI(false); }}
              >
                <Reply className="mr-1 h-3 w-3" /> Responder
              </Button>
              <Button
                variant={emailAction === "reply-all" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setEmailAction(emailAction === "reply-all" ? null : "reply-all"); setReplyText(""); setShowFullAI(false); }}
              >
                <ReplyAll className="mr-1 h-3 w-3" /> Todos
              </Button>
              <Button
                variant={emailAction === "forward" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setEmailAction(emailAction === "forward" ? null : "forward"); setReplyText(""); setForwardTo(""); setShowFullAI(false); }}
              >
                <Forward className="mr-1 h-3 w-3" /> Reenviar
              </Button>

              <div className="w-px h-5 bg-border mx-1" />

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setQuickAIPrompt("Resume los puntos clave de este correo en viñetas.");
                }}
              >
                <ListChecks className="mr-1 h-3 w-3" /> Resumir
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setQuickAIPrompt("Traduce este correo al inglés manteniendo el tono profesional.");
                }}
              >
                <Languages className="mr-1 h-3 w-3" /> Traducir
              </Button>

              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setCreateTaskOpen(true)}
                >
                  <ClipboardList className="mr-1 h-3 w-3" /> Tarea
                </Button>
              </div>
            </div>

            {/* Quick AI result (summarize/translate) */}
            {quickAIPrompt && (
              <div className="px-4 py-2 border-b border-border shrink-0">
                <EmailAIAssistant
                  mode="quick"
                  emailSubject={emailDetail.subject || ""}
                  emailBody={emailDetail.body?.content || ""}
                  senderName={emailDetail.from?.emailAddress?.name}
                  autoPrompt={quickAIPrompt}
                  onClose={() => setQuickAIPrompt(null)}
                />
              </div>
            )}

            {/* Email body */}
            <ScrollArea className="flex-1">
              <div className="p-4">
                {emailDetail.body?.contentType === "html" ? (
                  <iframe
                    srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#333;margin:0;padding:12px;word-wrap:break-word;line-height:1.5;}img{max-width:100%;height:auto;}a{color:hsl(221,83%,53%);}table{max-width:100%;border-collapse:collapse;}blockquote{border-left:3px solid #ddd;margin:8px 0;padding:4px 12px;color:#666;}</style></head><body>${emailDetail.body.content}</body></html>`}
                    sandbox="allow-same-origin"
                    className="w-full border-0 rounded-md bg-background"
                    style={{ minHeight: "300px", height: "100%" }}
                    title="Email content"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm p-2">{emailDetail.body?.content}</pre>
                )}
              </div>
            </ScrollArea>

            {/* Reply/Forward form */}
            {emailAction && (
              <div className="border-t border-border p-4 shrink-0 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {emailAction === "reply" ? "Responder" : emailAction === "reply-all" ? "Responder a todos" : "Reenviar"}
                  </Label>
                  <Button
                    variant={showFullAI ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowFullAI(!showFullAI)}
                  >
                    <Sparkles className="mr-1 h-3 w-3" /> Kawiil AI
                  </Button>
                </div>

                {showFullAI && (
                  <EmailAIAssistant
                    mode="full"
                    emailSubject={emailDetail.subject || ""}
                    emailBody={emailDetail.body?.content || ""}
                    senderName={emailDetail.from?.emailAddress?.name}
                    onInsertText={(text) => setReplyText((prev) => prev ? `${prev}\n\n${text}` : text)}
                    onClose={() => setShowFullAI(false)}
                  />
                )}

                {emailAction === "forward" && (
                  <Input
                    placeholder="Para (separar con coma): correo@ejemplo.com"
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                    className="text-sm h-8"
                  />
                )}
                <Textarea
                  placeholder={emailAction === "forward" ? "Mensaje al reenviar..." : "Escribe tu respuesta..."}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <div className="flex justify-between items-center">
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={resetAction}>
                    Cancelar
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleSendReply} disabled={isSending || !replyText.trim()}>
                    {isSending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="mr-1 h-3 w-3" />
                    )}
                    {emailAction === "forward" ? "Reenviar" : "Enviar"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Create task dialog */}
      <CreateTaskFromEmailDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        emailSubject={emailDetail?.subject}
        senderName={emailDetail?.from?.emailAddress?.name}
        senderEmail={emailDetail?.from?.emailAddress?.address}
        bodyPreview={emailDetail?.bodyPreview}
        receivedDate={emailDetail?.receivedDateTime ? formatDistanceToNow(parseISO(emailDetail.receivedDateTime), { addSuffix: true, locale: es }) : undefined}
      />
    </div>
  );
}
