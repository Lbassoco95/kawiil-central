import { useCallback, useMemo, useRef, useState } from "react";
import {
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  Star,
  MoreHorizontal,
  Paperclip,
  Sparkles,
  X,
  Send,
  ChevronDown,
  Flag,
  CheckCheck,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  useEmailDetail,
  useEmailAttachments,
  useArchiveEmail,
  useDeleteEmail,
  useMarkEmailRead,
  useMarkEmailUnread,
  useReplyEmail,
} from "@/hooks/useMicrosoft";
import {
  getAvatarGradient,
  getInitials,
  inferEmailChips,
} from "@/lib/emailChips";

// ─── Tipos locales ──────────────────────────────────────────────
interface EmailDetailShape {
  id?: string;
  subject?: string;
  isRead?: boolean;
  importance?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
  conversationId?: string;
}

interface Props {
  emailId: string | null;
  onCompose: () => void;
  onCreateTask: (email: EmailDetailShape) => void;
  onTranslate: (email: EmailDetailShape) => void;
}

// ─── Sanitiza HTML del body para iframe ────────────────────────
function sanitizeBodyForFrame(html: string): string {
  // Eliminar scripts y event handlers inline
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

// ─── Ícono de adjunto por tipo MIME / extensión ─────────────────
function attachIcon(name: string, contentType: string): { cls: string; label: string } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || contentType.includes("pdf"))    return { cls: "pdf",  label: "PDF" };
  if (ext === "xml" || contentType.includes("xml"))    return { cls: "xml",  label: "XML" };
  if (/xlsx?|xls/.test(ext) || contentType.includes("spreadsheet")) return { cls: "xlsx", label: "XLS" };
  if (/docx?/.test(ext) || contentType.includes("word")) return { cls: "docx", label: "DOC" };
  if (/png|jpg|jpeg|gif|webp/.test(ext) || contentType.startsWith("image/")) return { cls: "img", label: "IMG" };
  return { cls: "docx", label: ext.toUpperCase() || "FILE" };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const QUICK_REPLIES = [
  "Recibido, muchas gracias.",
  "Con gusto lo revisaré.",
  "Te confirmo en breve.",
  "Perfecto, quedo pendiente.",
];

export function MailPreview({ emailId, onCompose: _onCompose, onCreateTask, onTranslate }: Props) {
  const { data: emailDetail, isLoading } = useEmailDetail(emailId);
  const { data: attachments = [] } = useEmailAttachments(emailId ?? undefined);
  const archiveMut = useArchiveEmail();
  const deleteMut  = useDeleteEmail();
  const markRead   = useMarkEmailRead();
  const markUnread = useMarkEmailUnread();
  const replyMut   = useReplyEmail();

  const detail = emailDetail as EmailDetailShape | null | undefined;

  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const [quickReply, setQuickReply] = useState("");
  const [aiTab, setAiTab] = useState<"resumen" | "responder" | "tareas">("resumen");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const senderName = detail?.from?.emailAddress?.name || detail?.from?.emailAddress?.address || "";
  const senderEmail = detail?.from?.emailAddress?.address || "";
  const avatarBg = getAvatarGradient(senderEmail, senderName);
  const initials = getInitials(senderName, senderEmail);

  const chips = useMemo(() => detail ? inferEmailChips({
    from: detail.from,
    subject: detail.subject,
    importance: detail.importance,
  }) : [], [detail]);

  const receivedAt = useMemo(() => {
    if (!detail?.receivedDateTime) return "";
    try {
      return format(parseISO(detail.receivedDateTime), "d 'de' MMMM, HH:mm", { locale: es });
    } catch { return ""; }
  }, [detail?.receivedDateTime]);

  const toLine = useMemo(() => {
    const recipients = detail?.toRecipients ?? [];
    if (!recipients.length) return "—";
    const names = recipients.map((r) => r.emailAddress?.name || r.emailAddress?.address || "").filter(Boolean);
    if (!showAllRecipients && names.length > 2) {
      return names.slice(0, 2).join(", ");
    }
    return names.join(", ");
  }, [detail?.toRecipients, showAllRecipients]);

  const hasMoreRecipients = (detail?.toRecipients?.length ?? 0) > 2;

  const bodyHtml = useMemo(() => {
    if (!detail?.body) return "";
    if (detail.body.contentType?.toLowerCase() === "html") {
      return sanitizeBodyForFrame(detail.body.content ?? "");
    }
    return `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${detail.body.content ?? ""}</pre>`;
  }, [detail?.body]);

  const iframeSrc = useMemo(() => {
    if (!bodyHtml) return "";
    const blob = new Blob(
      [`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:system-ui,sans-serif;font-size:13.5px;line-height:1.6;color:#0f172a;
             margin:0;padding:0;word-break:break-word;overflow-wrap:anywhere;}
        img{max-width:100%!important;height:auto!important;}
        a{color:#2563eb;}
        blockquote{border-left:3px solid #e2e8f0;margin:10px 0;padding:2px 0 2px 12px;color:#64748b;}
        @media(prefers-color-scheme:dark){body{color:#f1f5f9;background:#1e293b;}blockquote{border-color:#334155;}}
      </style></head><body>${bodyHtml}</body></html>`],
      { type: "text/html" }
    );
    return URL.createObjectURL(blob);
  }, [bodyHtml]);

  const handleSendQuickReply = useCallback(() => {
    if (!quickReply.trim() || !emailId) return;
    replyMut.mutate({ messageId: emailId, bodyHtml: `<p>${quickReply}</p>` });
    setQuickReply("");
  }, [quickReply, emailId, replyMut]);

  // ── Empty state ──────────────────────────────────────────────
  if (!emailId) {
    return (
      <div className="mail-preview">
        <div className="mp-empty">
          <div className="mp-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </div>
          <h3>Selecciona un correo</h3>
          <p>Elige un mensaje de la lista para verlo aquí</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mail-preview">
        <div className="mp-empty">
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Cargando…</div>
        </div>
      </div>
    );
  }

  if (!detail) return <div className="mail-preview" />;

  const visibleAttachments = attachments.filter((a) => !a.isInline);

  return (
    <div className="mail-preview">
      {/* Toolbar */}
      <div className="mp-toolbar">
        <button
          className="mp-btn primary"
          onClick={() => {}}
          title="Responder"
        >
          <Reply size={13} className="ico" /> Responder
        </button>
        <button className="mp-btn" title="Responder a todos"><ReplyAll size={13} className="ico" /> Todos</button>
        <button className="mp-btn" title="Reenviar"><Forward size={13} className="ico" /> Reenviar</button>

        <div className="mp-toolbar-divider" />

        <button
          className="mp-btn icon-only"
          title="Archivar"
          onClick={() => detail.id && archiveMut.mutate(detail.id)}
        >
          <Archive size={14} className="ico" />
        </button>
        <button
          className="mp-btn icon-only"
          title="Eliminar"
          onClick={() => detail.id && deleteMut.mutate(detail.id)}
        >
          <Trash2 size={14} className="ico" />
        </button>
        <button
          className="mp-btn icon-only"
          title={detail.isRead ? "Marcar como no leído" : "Marcar como leído"}
          onClick={() => {
            if (!detail.id) return;
            detail.isRead
              ? markUnread.mutate(detail.id)
              : markRead.mutate(detail.id);
          }}
        >
          <CheckCheck size={14} className="ico" />
        </button>
        <button className="mp-btn icon-only" title="Destacar"><Star size={14} className="ico" /></button>
        <button className="mp-btn icon-only" title="Marcar"><Flag size={14} className="ico" /></button>

        <div className="mp-toolbar-divider" />

        <button
          className="mp-btn"
          onClick={() => onCreateTask(detail)}
        >
          <Sparkles size={13} className="ico" /> Crear tarea
        </button>
        <button
          className="mp-btn"
          onClick={() => onTranslate(detail)}
        >
          Traducir
        </button>
        <button className="mp-btn icon-only"><MoreHorizontal size={14} className="ico" /></button>
      </div>

      {/* Scroll principal */}
      <div className="mp-scroll">
        {/* Encabezado */}
        <div className="mp-header">
          <div className="mp-subject">
            {detail.subject || "(sin asunto)"}
            {chips.length > 0 && (
              <span className="mp-subject-chips">
                {chips.map((c) => (
                  <span key={c.label} className={`mi-chip ${c.tone}`}>{c.label}</span>
                ))}
              </span>
            )}
          </div>

          <div className="mp-from-row">
            <div className="mp-avatar" style={{ background: avatarBg }}>{initials}</div>

            <div className="mp-from-info">
              <div className="mp-from-name">{senderName}</div>
              <div className="mp-from-email">{senderEmail}</div>
              <div className="mp-to">
                Para: {toLine}
                {hasMoreRecipients && (
                  <button
                    className="expand"
                    onClick={() => setShowAllRecipients((p) => !p)}
                  >
                    {showAllRecipients
                      ? "Mostrar menos"
                      : `+${(detail.toRecipients?.length ?? 0) - 2} más`}
                    <ChevronDown size={11} style={{ display: "inline", marginLeft: 2 }} />
                  </button>
                )}
              </div>
            </div>

            <div className="mp-time-col">
              <div className="mp-time">{receivedAt}</div>
            </div>
          </div>
        </div>

        {/* AI Summary */}
        <div className="mp-ai-summary">
          <div className="mp-ai-head">
            <div className="mp-ai-logo">K</div>
            <span className="mp-ai-title">Kawiil AI</span>
            <div className="mp-ai-tabs">
              {(["resumen", "responder", "tareas"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`mp-ai-tab ${aiTab === tab ? "active" : ""}`}
                  onClick={() => setAiTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="mp-ai-body">
            {aiTab === "resumen" && (
              <p style={{ margin: 0, fontStyle: "italic", opacity: 0.7, fontSize: 12 }}>
                Selecciona "Resumen" para que Kawiil AI analice este correo.
              </p>
            )}
            {aiTab === "responder" && (
              <p style={{ margin: 0, fontStyle: "italic", opacity: 0.7, fontSize: 12 }}>
                AI puede redactar una respuesta personalizada basada en el contenido.
              </p>
            )}
            {aiTab === "tareas" && (
              <p style={{ margin: 0, fontStyle: "italic", opacity: 0.7, fontSize: 12 }}>
                AI puede extraer tareas y compromisos de este correo.
              </p>
            )}
          </div>

          <div className="mp-ai-actions">
            <button className="mp-ai-action primary">
              <Sparkles size={11} /> Analizar
            </button>
            <button className="mp-ai-action" onClick={() => onCreateTask(detail)}>
              Crear tarea
            </button>
            <button className="mp-ai-action" onClick={() => onTranslate(detail)}>
              Traducir
            </button>
          </div>
        </div>

        {/* Body del correo */}
        {iframeSrc ? (
          <div style={{ padding: "18px 22px 8px" }}>
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              title="Contenido del correo"
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              style={{
                width: "100%",
                minHeight: 320,
                border: 0,
                display: "block",
              }}
              onLoad={() => {
                const iframe = iframeRef.current;
                if (!iframe) return;
                try {
                  const body = iframe.contentDocument?.body;
                  if (body) iframe.style.height = `${body.scrollHeight + 24}px`;
                } catch {}
              }}
            />
          </div>
        ) : (
          <div className="mp-body">
            <p>{detail.bodyPreview}</p>
          </div>
        )}

        {/* Adjuntos */}
        {visibleAttachments.length > 0 && (
          <div className="mp-attachments">
            {visibleAttachments.map((att) => {
              const { cls, label } = attachIcon(att.name, att.contentType);
              return (
                <div key={att.id} className="mp-attach">
                  <div className={`mp-attach-icon ${cls}`}>{label}</div>
                  <div>
                    <div className="mp-attach-name" title={att.name}>{att.name}</div>
                    <div className="mp-attach-meta">
                      <Paperclip size={10} />
                      {formatBytes(att.size)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick reply */}
        <div className="mp-quick-reply">
          <div className="mp-qr-suggestions">
            <span className="mp-qr-label">
              <Sparkles size={10} />
              AI
            </span>
            {QUICK_REPLIES.map((qr) => (
              <button
                key={qr}
                className="mp-qr-chip"
                onClick={() => setQuickReply(qr)}
              >
                {qr}
              </button>
            ))}
          </div>
          <div className="mp-qr-input">
            <input
              placeholder="Escribe una respuesta rápida…"
              value={quickReply}
              onChange={(e) => setQuickReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendQuickReply()}
            />
            {quickReply && (
              <button
                onClick={() => setQuickReply("")}
                style={{ background: "transparent", border: 0, cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: "4px" }}
              >
                <X size={12} />
              </button>
            )}
            <button
              className="mp-qr-send"
              onClick={handleSendQuickReply}
              disabled={!quickReply.trim() || replyMut.isPending}
            >
              <Send size={12} style={{ display: "inline", marginRight: 4 }} />
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
