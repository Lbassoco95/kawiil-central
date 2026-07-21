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
  /** Correo ya cargado en la lista: metadatos + snippet para mostrar al instante. */
  seed?: Record<string, unknown> | null;
  onOpen: () => void;
  onReply: () => void;
}

/** Envuelve el HTML del correo en un documento responsivo (imágenes y tablas se ajustan al ancho). */
function responsiveSrcDoc(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<base target="_blank">` +
    `<style>` +
    `html,body{margin:0;padding:12px;box-sizing:border-box;overflow-x:hidden}` +
    `body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.6;color:#374151;word-wrap:break-word;overflow-wrap:anywhere}` +
    `img{max-width:100%!important;height:auto!important}` +
    `table{max-width:100%!important;width:auto!important;border-collapse:collapse}` +
    `*{max-width:100%}` +
    `a{color:#2563eb}` +
    `pre{white-space:pre-wrap;word-wrap:break-word}` +
    `</style></head><body>${inner}</body></html>`;
}

/**
 * Vista previa del correo seleccionado (columna derecha).
 * Un clic en la lista lo muestra aquí; "Abrir" pasa a la vista completa con respuesta.
 * Muestra al instante los datos del correo ya cargado (seed) y descarga el cuerpo completo en segundo plano.
 */
export function MailPreviewPanel({ emailId, seed, onOpen, onReply }: Props) {
  const { data: detail, isLoading, accountRef } = useRoutedEmailDetail(emailId);
  const { profile } = useMicrosoftConnection();
  const colorForAccount = useAccountColor();

  const d = (detail as any) ?? {};
  const s = (seed as any) ?? {};
  // Metadatos: preferimos el detalle completo; si aún no llega, usamos la semilla de la lista.
  const senderName = d?.from?.emailAddress?.name || d?.from?.emailAddress?.address
    || s?.from?.emailAddress?.name || s?.from?.emailAddress?.address || "";
  const senderEmail = d?.from?.emailAddress?.address || s?.from?.emailAddress?.address || "";
  const subject = d?.subject || s?.subject || "(sin asunto)";
  const ts = d?.receivedDateTime || s?.receivedDateTime;
  const receivedAt = ts ? format(new Date(ts), "EEEE d 'de' MMMM, HH:mm", { locale: es }) : "";
  const hasAttachments = !!(d?.hasAttachments ?? s?.hasAttachments);

  // Cuenta a la que pertenece: los vinculados traen _accountEmail; el primario usa el perfil.
  const accountEmail: string =
    (d?._accountEmail as string) || (s?._accountEmail as string) ||
    (accountRef.provider === "primary" ? (profile?.mail || profile?.userPrincipalName || "") : "");
  const accountId = (d?._accountId as string) || (s?._accountId as string) || undefined;
  const accountLabel = accountRef.provider === "primary" ? "Cuenta principal" : accountEmail;

  const bodyHtml = useMemo(() => {
    const content = d?.body?.content as string | undefined;
    if (!content) return "";
    if (d?.body?.contentType === "html") return responsiveSrcDoc(content);
    return responsiveSrcDoc(`<pre>${content}</pre>`);
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

  const snippet = (s?.bodyPreview as string) || (d?.bodyPreview as string) || "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Cuenta a la que llegó el correo */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-muted/20">
        {accountEmail && (
          <MailAccountBadge
            email={accountEmail}
            color={colorForAccount(accountRef.provider === "primary" ? undefined : accountId)}
            size="sm"
          />
        )}
        <span className="text-[11px] text-muted-foreground truncate flex-1" title={accountEmail}>
          {accountLabel}{accountRef.provider === "primary" && accountEmail ? ` · ${accountEmail}` : ""}
        </span>
      </div>

      {/* Encabezado — visible al instante desde la semilla */}
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

      {/* Cuerpo — cuerpo completo cuando llega; mientras, el snippet de la lista */}
      <div className="flex-1 min-h-0 bg-white relative">
        {bodyHtml ? (
          <iframe
            title="Vista previa del correo"
            sandbox="allow-same-origin"
            srcDoc={bodyHtml}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="p-4">
            {isLoading && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mb-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Cargando contenido…
              </div>
            )}
            <p className="text-[12.5px] text-muted-foreground whitespace-pre-wrap break-words">
              {snippet || (isLoading ? "" : "Sin contenido")}
            </p>
          </div>
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
