import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useOutlookEmails, useEmailDetail, useReplyEmail, useForwardEmail, useMarkEmailRead } from "@/hooks/useMicrosoft";
import { Search, Mail, MailOpen, Paperclip, Loader2, Reply, ReplyAll, Forward, Send, UserPlus } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CreateUserFromEmailDialog } from "./CreateUserFromEmailDialog";
import { useUserRole } from "@/hooks/useUserRole";

type EmailAction = "reply" | "reply-all" | "forward" | null;

export function EmailView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailAction, setEmailAction] = useState<EmailAction>(null);
  const [replyText, setReplyText] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const { isAdminOrManager } = useUserRole();

  const { data: emails = [], isLoading } = useOutlookEmails("inbox", debouncedSearch || undefined);
  const { data: emailDetail, isLoading: detailLoading } = useEmailDetail(selectedEmailId);
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();
  const markRead = useMarkEmailRead();

  const handleOpenEmail = (email: any) => {
    setSelectedEmailId(email.id);
    if (!email.isRead) {
      markRead.mutate(email.id);
    }
  };

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
  };

  const isSending = replyEmail.isPending || forwardEmail.isPending;

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar correos..."
          className="pl-9"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : emails.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Mail className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No se encontraron correos</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {emails.map((email: any) => (
            <Card
              key={email.id}
              className={`cursor-pointer transition-colors hover:border-primary/50 ${!email.isRead ? "bg-primary/5" : ""}`}
              onClick={() => { handleOpenEmail(email); resetAction(); }}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    {email.isRead ? (
                      <MailOpen className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Mail className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-sm truncate ${!email.isRead ? "font-semibold text-foreground" : "text-foreground"}`}>
                        {email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Desconocido"}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(parseISO(email.receivedDateTime), { addSuffix: true, locale: es })}
                      </span>
                    </div>
                    <p className={`text-sm truncate ${!email.isRead ? "font-medium" : "text-muted-foreground"}`}>
                      {email.subject || "(sin asunto)"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {email.bodyPreview?.substring(0, 120)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {email.hasAttachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                    {email.importance === "high" && <Badge variant="destructive" className="text-xs">Urgente</Badge>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Email detail dialog */}
      <Dialog open={!!selectedEmailId} onOpenChange={(open) => { if (!open) { setSelectedEmailId(null); resetAction(); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : emailDetail ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg pr-8">{emailDetail.subject || "(sin asunto)"}</DialogTitle>
                <div className="text-sm text-muted-foreground space-y-1 mt-2">
                  <p>
                    <strong>De:</strong> {emailDetail.from?.emailAddress?.name} &lt;{emailDetail.from?.emailAddress?.address}&gt;
                  </p>
                  <p>
                    <strong>Para:</strong>{" "}
                    {emailDetail.toRecipients?.map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", ")}
                  </p>
                  <p>
                    <strong>Fecha:</strong>{" "}
                    {emailDetail.receivedDateTime
                      ? formatDistanceToNow(parseISO(emailDetail.receivedDateTime), { addSuffix: true, locale: es })
                      : ""}
                  </p>
                </div>
              </DialogHeader>

              {/* Action buttons */}
              <div className="flex items-center gap-2 border-t border-b border-border py-2">
                <Button
                  variant={emailAction === "reply" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setEmailAction(emailAction === "reply" ? null : "reply"); setReplyText(""); }}
                >
                  <Reply className="mr-1 h-3.5 w-3.5" /> Responder
                </Button>
                <Button
                  variant={emailAction === "reply-all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setEmailAction(emailAction === "reply-all" ? null : "reply-all"); setReplyText(""); }}
                >
                  <ReplyAll className="mr-1 h-3.5 w-3.5" /> Responder a todos
                </Button>
                <Button
                  variant={emailAction === "forward" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setEmailAction(emailAction === "forward" ? null : "forward"); setReplyText(""); setForwardTo(""); }}
                >
                  <Forward className="mr-1 h-3.5 w-3.5" /> Reenviar
                </Button>
                {isAdminOrManager && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setCreateUserOpen(true)}
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" /> Dar de alta
                  </Button>
                )}
              </div>

              {/* Reply/Forward form */}
              {emailAction && (
                <div className="space-y-3 border border-border rounded-lg p-3 bg-muted/30">
                  {emailAction === "forward" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Para (separar con coma)</Label>
                      <Input
                        placeholder="correo@ejemplo.com"
                        value={forwardTo}
                        onChange={(e) => setForwardTo(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {emailAction === "forward" ? "Mensaje" : "Respuesta"}
                    </Label>
                    <Textarea
                      placeholder={emailAction === "forward" ? "Mensaje al reenviar..." : "Escribe tu respuesta..."}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleSendReply} disabled={isSending || !replyText.trim()}>
                      {isSending ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="mr-1 h-3.5 w-3.5" />
                      )}
                      {emailAction === "forward" ? "Reenviar" : "Enviar respuesta"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Email body */}
              <div className="flex-1 overflow-y-auto mt-2 prose prose-sm max-w-none dark:prose-invert">
                {emailDetail.body?.contentType === "html" ? (
                  <div dangerouslySetInnerHTML={{ __html: emailDetail.body.content }} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">{emailDetail.body?.content}</pre>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Create user from email dialog */}
      <CreateUserFromEmailDialog
        open={createUserOpen}
        onOpenChange={setCreateUserOpen}
        senderName={emailDetail?.from?.emailAddress?.name}
        senderEmail={emailDetail?.from?.emailAddress?.address}
      />
    </div>
  );
}
