import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOutlookEmails, useEmailDetail } from "@/hooks/useMicrosoft";
import { Search, Mail, MailOpen, Paperclip, Loader2 } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export function EmailView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  const { data: emails = [], isLoading } = useOutlookEmails("inbox", debouncedSearch || undefined);
  const { data: emailDetail, isLoading: detailLoading } = useEmailDetail(selectedEmailId);

  // Debounce search
  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__emailSearchTimeout);
    (window as any).__emailSearchTimeout = setTimeout(() => setDebouncedSearch(val), 500);
  };

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
              onClick={() => setSelectedEmailId(email.id)}
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
      <Dialog open={!!selectedEmailId} onOpenChange={(open) => !open && setSelectedEmailId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : emailDetail ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{emailDetail.subject || "(sin asunto)"}</DialogTitle>
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
              <div className="mt-4 prose prose-sm max-w-none dark:prose-invert">
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
    </div>
  );
}
