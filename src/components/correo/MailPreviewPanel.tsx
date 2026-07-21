import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Mail, Reply, Maximize2, Loader2, Paperclip } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useRoutedEmailDetail } from "@/hooks/useLinkedAccounts";
import { useAccountColor } from "@/lib/accountColors";
import { MailAccountBadge } from "./MailAccountBadge";

interface Props {
  emailId: string | null;
  onOpen: () => void;
  onReply: () => void;
}

/**
 * Vista previa del correo seleccionado (columna derecha).
 * Un clic en la lista lo muestra aquí; "Abrir" pasa a la vista completa con respuesta.
 */
export function MailPreviewPanel({ emailId, onOpen, onReply }: Props) {
  const { data: detail, isLoading, accountRef } = useRoutedEmailDetail(emailId);
  const { profile } = useMicrosoftConnection();
  const colorForAccount = useAccountColor();

  const d = detail as any;
  const senderName = d?.from?.emailAddress?.name || d?.from?.emailAddress?.address || "";
  const senderEmail = d?.from?.emailAddress?.address || "";
  const subject = d?.subject || "(sin asunto)";
  const receivedAt = d?.receivedDateTime
    ? format(new Date(d.receivedDateTime), "EEEE d 'de' MMMM, HH:mm", { locale: es })
    : "";
  const hasAttachments = !!d?.hasAttachments;

  // Cuenta a la que pertenece: los vinculados traen _accountEmail; el primario usa el perfil.
  const accountEmail: string =
    (d?._accountEmail as string) ||
    (accountRef.provider === "primary" ? (profile?.mail || profile?.userPrincipalName || "") : "");
  const accountLabel = accountRef.provider === "primary" ? "Cuenta principal" : accountEmail;

  const bodyHtml = useMemo(() => {
    const content = d?.body?.content as string | undefined;
    if (!content) return "";
    if (d?.body?.contentType === "html") return content;
    return `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${content}</pre>`;
  }, [d]);

  if (!emailId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <Mail className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-[13px] text-muted-foreground">Selecciona un correo</p>
        <p className="text-[11.5px] text-muted-foreground/60">
          Un clic muestra la vista previa aquí; doble clic lo abre completo.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[12.5px] text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando vista previa…
      </div>
    );
  }

  if (!d) {
    return (
      <div className="flex items-center justify-center h-full px-6 text-center">
        <p className="text-[12.5px] text-muted-foreground">No se pudo cargar la vista previa de este correo.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Cuenta a la que llegó el correo */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-muted/20">
        {accountEmail && (
          <MailAccountBadge
            email={accountEmail}
            color={colorForAccount(accountRef.provider === "primary" ? undefined : accountRef.accountId)}
            size="sm"
          />
        )}
        <span className="text-[11px] text-muted-foreground truncate flex-1" title={accountEmail}>
          {accountLabel}{accountRef.provider === "primary" && accountEmail ? ` · ${accountEmail}` : ""}
        </span>
      </div>

      {/* Encabezado */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-border/30 space-y-1.5">
        <p className="text-[13.5px] font-semibold text-foreground leading-snug break-words">
          {hasAttachments && <Paperclip className="inline w-3.5 h-3.5 mr-1 text-muted-foreground/70" />}
          {subject}
        </p>
        <p className="text-[12px] text-foreground/80 truncate" title={senderEmail}>
          {senderName}
          {senderEmail && senderName !== senderEmail && (
            <span className="text-muted-foreground"> · {senderEmail}</span>
          )}
        </p>
        {receivedAt && <p className="text-[11px] text-muted-foreground">{receivedAt}</p>}
      </div>

      {/* Cuerpo */}
      <div className="flex-1 min-h-0 bg-white">
        {bodyHtml ? (
          <iframe
            title="Vista previa del correo"
            sandbox=""
            srcDoc={bodyHtml}
            className="w-full h-full border-0"
          />
        ) : (
          <p className="p-4 text-[12.5px] text-muted-foreground whitespace-pre-wrap">
            {d?.bodyPreview || "Sin contenido"}
          </p>
        )}
      </div>

      {/* Acciones */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-border/40 bg-card">
        <button
          onClick={onOpen}
          className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Abrir
        </button>
        <button
          onClick={onReply}
          className={cn(
            "flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium",
            "text-foreground hover:bg-accent transition-colors",
          )}
        >
          <Reply className="w-3.5 h-3.5" />
          Responder
        </button>
      </div>
    </div>
  );
}
