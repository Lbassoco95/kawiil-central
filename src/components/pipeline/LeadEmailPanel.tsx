import { useMemo, useState } from "react";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useImportLeadEmails, useLeadEmailLog, useSyncInboxEmails } from "@/hooks/usePipeline";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Mail,
  Send,
  Inbox,
  ChevronDown,
  ChevronUp,
  Reply,
  Plus,
  Eye,
  MousePointer,
  RefreshCw,
  Clock,
  MailSearch,
} from "lucide-react";
import { SendEmailModal, type ReplyToEmail } from "@/components/pipeline/modals/SendEmailModal";

type EmailRow = Tables<"email_log">;

function groupByConversation(emails: EmailRow[]): { conversationId: string | null; emails: EmailRow[] }[] {
  const groups: Record<string, EmailRow[]> = {};
  const standalone: EmailRow[] = [];

  for (const email of emails) {
    const cid = email.conversation_id;
    if (cid) {
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(email);
    } else {
      standalone.push(email);
    }
  }

  const result: { conversationId: string | null; emails: EmailRow[] }[] = Object.entries(groups).map(
    ([conversationId, ev]) => ({ conversationId, emails: ev }),
  );

  for (const email of standalone) {
    result.push({ conversationId: null, emails: [email] });
  }

  result.sort((a, b) => {
    const maxA = Math.max(
      ...a.emails.map((e) =>
        new Date(e.sent_at || e.received_at || e.created_at).getTime(),
      ),
    );
    const maxB = Math.max(
      ...b.emails.map((e) =>
        new Date(e.sent_at || e.received_at || e.created_at).getTime(),
      ),
    );
    return maxB - maxA;
  });

  return result;
}

function sanitize(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function EmailCard({
  email,
  isLast,
  mailboxLabel,
  onReply,
}: {
  email: EmailRow;
  isLast: boolean;
  mailboxLabel: string;
  onReply: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOutbound = email.direction === "outbound";
  const timestamp = email.sent_at || email.received_at || email.created_at;
  const extraTo = Array.isArray(email.additional_to_emails) ? email.additional_to_emails : [];
  const outboundToLabel =
    extraTo.length > 0
      ? `${email.to_email} +${extraTo.length} (${extraTo.join(", ")})`
      : email.to_email;

  return (
    <div
      className={`p-4 ${!isLast ? "border-b border-border/60" : ""} ${!isOutbound ? "bg-blue-500/5 dark:bg-blue-950/20" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isOutbound ? (
            <Send className="h-4 w-4 text-green-600 shrink-0" />
          ) : (
            <Inbox className="h-4 w-4 text-blue-600 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" title={isOutbound ? outboundToLabel : undefined}>
              {isOutbound
                ? `${mailboxLabel} → ${outboundToLabel}`
                : `${email.from_name || email.from_email || "?"} → ${mailboxLabel}`}
            </p>
            <p className="text-sm text-muted-foreground truncate">{email.subject}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 shrink-0 justify-end">
          {isOutbound && email.status === "sent" && (
            <Badge variant="outline" className="text-green-700 border-green-200 text-[10px]">
              Enviado
            </Badge>
          )}
          {isOutbound && email.status === "opened" && (
            <Badge variant="outline" className="text-purple-700 border-purple-200 text-[10px]">
              <Eye className="h-3 w-3 mr-0.5" />
              Abierto
            </Badge>
          )}
          {isOutbound && email.status === "clicked" && (
            <Badge variant="outline" className="text-orange-700 border-orange-200 text-[10px]">
              <MousePointer className="h-3 w-3 mr-0.5" />
              Clic
            </Badge>
          )}
          {!isOutbound && (
            <Badge variant="outline" className="text-blue-700 border-blue-200 text-[10px]">
              Recibido
            </Badge>
          )}
          {email.opened_at && email.status !== "opened" && (
            <Badge variant="outline" className="text-purple-600 text-[10px]">
              <Eye className="h-3 w-3 mr-0.5" />
              Abierto
            </Badge>
          )}
          {email.clicked_at && (
            <Badge variant="outline" className="text-orange-600 text-[10px]">
              <MousePointer className="h-3 w-3 mr-0.5" />
              Clic
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 mt-1 ml-6">
        <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: es })}
        </span>
      </div>

      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex flex-wrap items-center gap-2 mt-2 ml-6">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs h-7 px-2">
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3 mr-1" /> Ocultar
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3 mr-1" /> Ver contenido
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          {!isOutbound && email.graph_message_id && (
            <Button variant="ghost" size="sm" className="text-xs h-7 px-2" type="button" onClick={onReply}>
              <Reply className="h-3 w-3 mr-1" /> Responder
            </Button>
          )}
        </div>
        <CollapsibleContent>
          <div
            className="mt-3 ml-6 p-4 bg-background border rounded-md text-sm prose prose-sm dark:prose-invert max-w-none max-h-[min(50vh,400px)] overflow-y-auto"
            dangerouslySetInnerHTML={{
              __html: sanitize(email.body_html) || sanitize(email.body_text) || "<p class='text-muted-foreground'>Sin contenido</p>",
            }}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function EmailThreadGroup({
  emails,
  mailboxLabel,
  onReply,
}: {
  emails: EmailRow[];
  mailboxLabel: string;
  onReply: (e: EmailRow) => void;
}) {
  const sorted = [...emails].sort(
    (a, b) =>
      new Date(a.sent_at || a.received_at || a.created_at).getTime() -
      new Date(b.sent_at || b.received_at || b.created_at).getTime(),
  );

  return (
    <div className="border rounded-lg overflow-hidden bg-card shadow-sm">
      {sorted.map((email, idx) => (
        <EmailCard
          key={email.id}
          email={email}
          isLast={idx === sorted.length - 1}
          mailboxLabel={mailboxLabel}
          onReply={() => onReply(email)}
        />
      ))}
    </div>
  );
}

type Props = {
  leadId: string;
  leadEmail: string;
  leadName: string;
};

export function LeadEmailPanel({ leadId, leadEmail, leadName }: Props) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyToEmail | null>(null);
  const { data: emails = [], isLoading } = useLeadEmailLog(leadId);
  const syncMutation = useSyncInboxEmails();
  const importMutation = useImportLeadEmails();

  const grouped = useMemo(() => groupByConversation(emails), [emails]);
  const mailboxLabel = "Kawiil";

  const openCompose = () => {
    setReplyTo(null);
    setComposeOpen(true);
  };

  const openReply = (e: EmailRow) => {
    if (!e.graph_message_id) return;
    setReplyTo({
      graph_message_id: e.graph_message_id,
      subject: e.subject,
      from_email: e.from_email,
      body_html: e.body_html,
    });
    setComposeOpen(true);
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setReplyTo(null);
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Correo electrónico
        </CardTitle>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={!leadEmail || importMutation.isPending}
            onClick={() =>
              importMutation.mutate(
                { leadId, email: leadEmail },
                {
                  onSuccess: (data) => {
                    const n = typeof data?.imported === "number" ? data.imported : 0;
                    toast.success(
                      n > 0
                        ? `Se migraron ${n} correo(s) del buzón a este lead`
                        : "No hay correos nuevos de este prospecto en el buzón",
                    );
                  },
                  onError: (e: Error) => toast.error(e.message || "Error al buscar en el buzón"),
                },
              )
            }
            title="Buscar en el buzón los correos de este prospecto y migrarlos al lead"
          >
            <MailSearch className={`h-4 w-4 ${importMutation.isPending ? "animate-pulse" : ""}`} />
            <span className="ml-1 hidden text-xs sm:inline">Buscar en buzón</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() =>
              syncMutation.mutate(undefined, {
                onSuccess: (data) => {
                  const n = typeof data?.synced === "number" ? data.synced : 0;
                  toast.success(
                    n > 0
                      ? `Sincronizados ${n} correo(s) entrante(s)`
                      : "Buzón actualizado; sin mensajes nuevos",
                  );
                },
                onError: (e: Error) => toast.error(e.message || "Error al sincronizar"),
              })
            }
            disabled={syncMutation.isPending}
            title="Sincronizar buzón (Microsoft 365)"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" type="button" onClick={openCompose} disabled={!leadEmail}>
            <Plus className="h-4 w-4 mr-1" />
            Nuevo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!leadEmail ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Este lead no tiene email; no se puede enviar ni enlazar respuestas.
          </p>
        ) : isLoading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Cargando correos…</p>
        ) : emails.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No hay correos para este lead</p>
        ) : (
          grouped.map((g) => (
            <EmailThreadGroup
              key={g.conversationId || g.emails[0].id}
              emails={g.emails}
              mailboxLabel={mailboxLabel}
              onReply={openReply}
            />
          ))
        )}
      </CardContent>

      {composeOpen && (
        <SendEmailModal
          open={composeOpen}
          onClose={closeCompose}
          leadId={leadId}
          leadEmail={leadEmail}
          leadName={leadName}
          replyTo={replyTo}
        />
      )}
    </Card>
  );
}
