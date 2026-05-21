import type { SlackMessage } from "@/lib/slackApi";

// ─── Utilidades ──────────────────────────────────────────────
function formatTs(ts: string): string {
  if (!ts) return "";
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.substring(0, 2) || "??").toUpperCase();
}

const AVATAR_COLORS = [
  "#5865F2","#57F287","#FEE75C","#EB459E","#ED4245",
  "#7289DA","#43B581","#FAA61A","#F47FFF","#1abc9c",
];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function slackTextToHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~([^~]+)~/g, "<del>$1</del>")
    .replace(/<@([A-Z0-9]+)>/g, '<span class="mention">@$1</span>')
    .replace(/\n/g, "<br/>");
}

// ─── Componente ──────────────────────────────────────────────
interface Props {
  message: SlackMessage;
  isCompact?: boolean;
  userName?: string;
  avatarUrl?: string;
  isSelf?: boolean;
  onOpenThread?: (ts: string) => void;
  onReact?: (ts: string, emoji: string) => void;
  onSaveForLater?: (msg: SlackMessage) => void;
}

export function MessageItem({
  message,
  isCompact = false,
  userName,
  avatarUrl,
  isSelf = false,
  onOpenThread,
  onReact,
  onSaveForLater,
}: Props) {
  const name = userName || message.user || message.bot_id || "Usuario";
  const initials = getInitials(name);
  const color = avatarColor(message.user || message.bot_id || "x");
  const time = formatTs(message.ts ?? "");
  const isBot = !!message.bot_id;

  return (
    <div className={`sl-msg${isCompact ? " compact" : ""}`} data-ts={message.ts}>
      {/* Avatar */}
      {!isCompact && (
        <div className="sl-avatar" style={{ background: avatarUrl ? "transparent" : color }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} />
          ) : (
            initials
          )}
        </div>
      )}

      {/* Cuerpo */}
      <div className="sl-msg-body">
        {!isCompact && (
          <div className="sl-msg-head">
            <span className="sl-msg-name">
              {name}
              {isSelf && " (tú)"}
            </span>
            {isBot && <span className="sl-msg-badge app">App</span>}
            <span className="sl-msg-time">{time}</span>
          </div>
        )}

        {/* Texto */}
        <div
          className="sl-msg-text"
          dangerouslySetInnerHTML={{ __html: slackTextToHtml(message.text ?? "") }}
        />

        {/* Archivos adjuntos */}
        {message.files && message.files.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {message.files.map((f: any) => (
              <a
                key={f.id}
                href={f.url_private || f.permalink}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 12,
                  color: "hsl(var(--primary))",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
                {f.name || "adjunto"}
              </a>
            ))}
          </div>
        )}

        {/* Reacciones */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="sl-reactions">
            {message.reactions.map((r: any) => (
              <button
                key={r.name}
                className="sl-react-pill"
                onClick={() => onReact?.(message.ts ?? "", r.name)}
              >
                {r.name.includes(":") ? r.name : `:${r.name}:`} {r.count}
              </button>
            ))}
          </div>
        )}

        {/* Hilo */}
        {(message.reply_count ?? 0) > 0 && (
          <div
            className="sl-thread-reply"
            onClick={() => onOpenThread?.(message.thread_ts || message.ts || "")}
          >
            <div className="sl-thread-avs">
              {[...Array(Math.min(message.reply_count ?? 0, 3))].map((_, i) => (
                <div key={i} className="av" style={{ background: color, zIndex: 3 - i }}>
                  {initials}
                </div>
              ))}
            </div>
            <span style={{ fontSize: 13, color: "hsl(var(--primary))", fontWeight: 600 }}>
              {message.reply_count} {message.reply_count === 1 ? "respuesta" : "respuestas"}
            </span>
            <span className="sl-thread-last">
              {message.latest_reply ? formatTs(message.latest_reply) : ""}
            </span>
          </div>
        )}
      </div>

      {/* Acciones hover */}
      <div className="sl-msg-actions">
        <button className="sl-msg-action" title="Reaccionar" onClick={() => onReact?.(message.ts ?? "", "thumbsup")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
        {onOpenThread && (
          <button className="sl-msg-action" title="Responder en hilo" onClick={() => onOpenThread(message.thread_ts || message.ts || "")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        )}
        {onSaveForLater && (
          <button className="sl-msg-action" title="Guardar para después" onClick={() => onSaveForLater(message)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
            </svg>
          </button>
        )}
        <button className="sl-msg-action ai" title="Resumen IA">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm-1-11h2v6h-2Zm0-4h2v2h-2Z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
