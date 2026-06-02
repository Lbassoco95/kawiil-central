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

      {/* Puntos animados */}
      <span className="sl-typing-dots" aria-hidden>
        <span /><span /><span />
      </span>
    </div>
  );
}
