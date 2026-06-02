import type { TypingUser } from "@/hooks/useSlackTyping";

interface Props {
  typingUsers: TypingUser[];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.substring(0, 2) || "??").toUpperCase();
}

const AV_COLORS = ["#5865F2","#57F287","#EB459E","#7289DA","#43B581","#FAA61A"];
function avColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

function typingText(users: TypingUser[]): string {
  if (users.length === 0) return "";
  const names = users.map((u) => u.userName);
  if (names.length === 1) return `${names[0]} está escribiendo`;
  if (names.length === 2) return `${names[0]} y ${names[1]} están escribiendo`;
  return `${names[0]} y ${names.length - 1} más están escribiendo`;
}

export function TypingIndicator({ typingUsers }: Props) {
  if (typingUsers.length === 0) return null;

  return (
    <div className="sl-typing-bar">
      <div className="sl-typing-avatars">
        {typingUsers.slice(0, 3).map((u) => (
          <div
            key={u.userId}
            className="sl-typing-av"
            title={u.userName}
            style={{ background: u.avatarUrl ? "transparent" : avColor(u.userId) }}
          >
            {u.avatarUrl
              ? <img src={u.avatarUrl} alt={u.userName} />
              : getInitials(u.userName)}
          </div>
        ))}
      </div>

      <span className="sl-typing-text">{typingText(typingUsers)}</span>
      {/* Icono Slack si al menos uno viene de la app nativa */}
      {typingUsers.some((u) => u.fromSlack) && (
        <span className="sl-typing-slack-badge" title="Escribiendo desde Slack">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
          </svg>
        </span>
      )}

      {/* Puntos animados */}
      <span className="sl-typing-dots" aria-hidden>
        <span /><span /><span />
      </span>
    </div>
  );
}
