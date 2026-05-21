import { useState, useMemo } from "react";
import type { SlackConversation } from "@/lib/slackApi";

// ─── Helpers ────────────────────────────────────────────────
function channelIcon(conv: SlackConversation): string {
  if (conv.is_im) return "";      // avatar handled separately
  if (conv.is_mpim) return "✦";
  if (conv.is_private) return "🔒";
  return "#";
}

function convTitle(conv: SlackConversation, userMap: Record<string, { display_name?: string; real_name?: string }> = {}): string {
  if (conv.is_im && conv.user) {
    const u = userMap[conv.user];
    return u?.display_name || u?.real_name || conv.user;
  }
  if (conv.is_mpim && conv.name) {
    return conv.name.replace(/^mpdm-|--\d+$/g, "").replace(/-/g, ", ");
  }
  return conv.name || conv.id;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// ─── Sección colapsable ──────────────────────────────────────
function Section({
  title,
  children,
  defaultOpen = true,
  onAdd,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onAdd?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`sl-sec${open ? "" : " collapsed"}`}>
      <div className="sl-sec-head" onClick={() => setOpen((p) => !p)}>
        <span>{title}</span>
        <span className="chevr">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </span>
        {onAdd && (
          <span
            className="add"
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
          >
            +
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}

// ─── Fila de canal ───────────────────────────────────────────
function ChannelRow({
  conv,
  isActive,
  unread,
  onClick,
  userMap,
}: {
  conv: SlackConversation;
  isActive: boolean;
  unread: number;
  onClick: () => void;
  userMap: Record<string, { display_name?: string; real_name?: string }>;
}) {
  const title = convTitle(conv, userMap);
  const icon = channelIcon(conv);
  const isDm = conv.is_im || conv.is_mpim;

  return (
    <div
      className={`sl-ch${isActive ? " active" : ""}${unread > 0 ? " unread" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {isDm ? (
        <span
          className="sl-ch-avatar"
          style={{ background: "hsl(var(--primary))" }}
        >
          {getInitials(title)}
        </span>
      ) : (
        <span className="ch-ico">{icon}</span>
      )}
      <span className="ch-name" title={title}>{title}</span>
      {unread > 0 && (
        <span className="ch-badge">{unread > 99 ? "99+" : unread}</span>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────
interface Props {
  workspaceName: string;
  conversations: SlackConversation[];
  isLoading: boolean;
  selectedChannel: string;
  onSelectChannel: (id: string) => void;
  unreadByChannel: Record<string, number>;
  userMap?: Record<string, { display_name?: string; real_name?: string }>;
  onNewMessage?: () => void;
  onRefresh?: () => void;
}

export function ChannelSidebar({
  workspaceName,
  conversations,
  isLoading,
  selectedChannel,
  onSelectChannel,
  unreadByChannel,
  userMap = {},
  onNewMessage,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) =>
      convTitle(c, userMap).toLowerCase().includes(q)
    );
  }, [conversations, search, userMap]);

  const starred   = filtered.filter((c) => (c as any).is_starred);
  const channels  = filtered.filter((c) => !c.is_im && !c.is_mpim && !(c as any).is_starred);
  const dms       = filtered.filter((c) => (c.is_im || c.is_mpim) && !(c as any).is_starred);

  return (
    <div className="sl-channels">
      {/* Cabecera workspace */}
      <div className="sl-head">
        <div className="sl-head-top">
          <span className="sl-workspace-name">
            {workspaceName}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </span>
          <button
            className="sl-compose-btn"
            onClick={onNewMessage}
            title="Nuevo mensaje directo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>

        {/* Búsqueda */}
        <div className="sl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar canales…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="ai-badge">AI</span>
        </div>
      </div>

      {/* Scroll de secciones */}
      <div className="sl-scroll">
        {isLoading && (
          <div style={{ padding: "12px", fontSize: 12, color: "hsl(var(--sidebar-foreground) / 0.5)" }}>
            Cargando canales…
          </div>
        )}

        {starred.length > 0 && (
          <Section title="Destacados">
            {starred.map((c) => (
              <ChannelRow
                key={c.id}
                conv={c}
                isActive={selectedChannel === c.id}
                unread={unreadByChannel[c.id] ?? 0}
                onClick={() => onSelectChannel(c.id)}
                userMap={userMap}
              />
            ))}
          </Section>
        )}

        {channels.length > 0 && (
          <Section title="Canales" defaultOpen>
            {channels.map((c) => (
              <ChannelRow
                key={c.id}
                conv={c}
                isActive={selectedChannel === c.id}
                unread={unreadByChannel[c.id] ?? 0}
                onClick={() => onSelectChannel(c.id)}
                userMap={userMap}
              />
            ))}
          </Section>
        )}

        {dms.length > 0 && (
          <Section title="Mensajes directos" onAdd={onNewMessage}>
            {dms.map((c) => (
              <ChannelRow
                key={c.id}
                conv={c}
                isActive={selectedChannel === c.id}
                unread={unreadByChannel[c.id] ?? 0}
                onClick={() => onSelectChannel(c.id)}
                userMap={userMap}
              />
            ))}
          </Section>
        )}

        {/* Actualizar */}
        {onRefresh && (
          <div style={{ padding: "8px 8px 0" }}>
            <button
              onClick={onRefresh}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: 0,
                color: "hsl(var(--sidebar-foreground) / 0.5)",
                fontSize: 11,
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 6,
                width: "100%",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/>
              </svg>
              Actualizar lista
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
