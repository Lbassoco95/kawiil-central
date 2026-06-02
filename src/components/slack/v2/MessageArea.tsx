import { useEffect, useRef, useMemo, useState } from "react";
import type { SlackMessage, SlackConversation } from "@/lib/slackApi";
import { MessageItem } from "./MessageItem";

// ─── Utilidades ──────────────────────────────────────────────
function formatDateSep(ts: string): string {
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(parseFloat(a) * 1000);
  const db = new Date(parseFloat(b) * 1000);
  return da.toDateString() === db.toDateString();
}

// ─── Componente ──────────────────────────────────────────────
interface Props {
  channel: SlackConversation | null;
  channelId: string;
  messages: SlackMessage[];
  isLoading: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onOpenThread?: (ts: string) => void;
  onReact?: (ts: string, emoji: string) => void;
  onSaveForLater?: (msg: SlackMessage) => void;
  onCreateTask?: (msg: SlackMessage) => void;
  userMap?: Record<string, { display_name?: string; real_name?: string; avatar_url?: string }>;
  selfUserId?: string;
  onOpenActivity?: () => void;
  onOpenAi?: () => void;
  onBack?: () => void;
  isFetchingNextPage?: boolean;
}

export function MessageArea({
  channel,
  channelId,
  messages,
  isLoading,
  hasMore = false,
  onLoadMore,
  onOpenThread,
  onReact,
  onSaveForLater,
  onCreateTask,
  userMap = {},
  selfUserId,
  onOpenActivity,
  onOpenAi,
  onBack,
  isFetchingNextPage,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const [slowLoad, setSlowLoad] = useState(false);

  // Indicador de carga lenta — aparece tras 8s si sigue sin mensajes
  useEffect(() => {
    if (!isLoading) { setSlowLoad(false); return; }
    const t = setTimeout(() => setSlowLoad(true), 8_000);
    return () => clearTimeout(t);
  }, [isLoading, channelId]);

  const channelName =
    channel?.name ||
    (channel?.is_im && channel.user && (userMap[channel.user]?.display_name || userMap[channel.user]?.real_name)) ||
    channelId;

  const channelDesc =
    (channel as any)?.topic?.value ||
    (channel as any)?.purpose?.value ||
    "";

  // Scroll al fondo cuando llegan mensajes nuevos
  useEffect(() => {
    if (!scrollRef.current) return;
    if (messages.length > prevCountRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Detectar scroll al tope para cargar más
  const handleScroll = () => {
    if (!scrollRef.current || !hasMore || isFetchingNextPage) return;
    if (scrollRef.current.scrollTop < 60) {
      onLoadMore?.();
    }
  };

  // Agrupar mensajes con compact (consecutivos del mismo usuario)
  const grouped = useMemo(() => {
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const isCompact =
        !!prev &&
        prev.user === m.user &&
        isSameDay(prev.ts ?? "", m.ts ?? "") &&
        parseFloat(m.ts ?? "0") - parseFloat(prev.ts ?? "0") < 300; // 5 min
      return { msg: m, isCompact };
    });
  }, [messages]);

  // Separadores de fecha
  const withDays = useMemo(() => {
    type Row = { type: "sep"; label: string } | { type: "msg"; msg: SlackMessage; isCompact: boolean };
    const rows: Row[] = [];
    let lastDay = "";
    for (const { msg, isCompact } of grouped) {
      const ts = msg.ts ?? "";
      const day = ts ? new Date(parseFloat(ts) * 1000).toDateString() : "";
      if (day && day !== lastDay) {
        rows.push({ type: "sep", label: formatDateSep(ts) });
        lastDay = day;
      }
      rows.push({ type: "msg", msg, isCompact });
    }
    return rows;
  }, [grouped]);

  return (
    <div className="sl-msgs">
      {/* Cabecera del canal */}
      <div className="sl-msgs-head">
        <div className="sl-msgs-title">
          <div className="sl-msgs-name">
            {onBack && (
              <button
                className="sl-back-btn"
                onClick={onBack}
                title="Volver a canales"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </button>
            )}
            {!channel?.is_im && !channel?.is_mpim && (
              <span className="hash">#</span>
            )}
            {channelName}
          </div>
          {channelDesc && (
            <div className="sl-msgs-meta">
              <span>{channelDesc}</span>
            </div>
          )}
        </div>

        <div className="sl-msgs-actions">
          {onOpenAi && (
            <button
              className="sl-act-btn ai"
              title="Asistente IA"
              onClick={onOpenAi}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
                <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
              </svg>
              IA
            </button>
          )}
          {onOpenActivity && (
            <button
              className="sl-act-btn"
              title="Actividad"
              onClick={onOpenActivity}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Mensajes */}
      <div
        className="sl-msgs-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {/* Cargar más (al tope) */}
        {hasMore && (
          <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12 }}>
            {isFetchingNextPage ? (
              <span style={{ color: "hsl(var(--muted-foreground))" }}>Cargando más…</span>
            ) : (
              <button
                onClick={onLoadMore}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "hsl(var(--primary))",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Cargar mensajes anteriores
              </button>
            )}
          </div>
        )}

        {isLoading && messages.length === 0 && (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <span>Cargando mensajes…</span>
            {slowLoad && (
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground) / 0.7)", maxWidth: 260 }}>
                Primera carga del canal — puede tardar unos segundos más.
              </span>
            )}
          </div>
        )}

        {!isLoading && messages.length === 0 && channelId && (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
            No hay mensajes todavía.
          </div>
        )}

        {!channelId && (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
            Selecciona un canal para ver los mensajes.
          </div>
        )}

        {withDays.map((row, i) => {
          if (row.type === "sep") {
            return (
              <div key={`sep-${i}`} className="sl-date-sep">
                <span>{row.label}</span>
              </div>
            );
          }
          const { msg, isCompact } = row;
          const uProfile = userMap[msg.user ?? ""];
          return (
            <MessageItem
              key={msg.ts}
              message={msg}
              isCompact={isCompact}
              userName={uProfile?.display_name || uProfile?.real_name || msg.user}
              avatarUrl={uProfile?.avatar_url}
              isSelf={msg.user === selfUserId}
              selfUserId={selfUserId}
              userMap={userMap}
              onOpenThread={onOpenThread}
              onReact={onReact}
              onSaveForLater={onSaveForLater}
              onCreateTask={onCreateTask}
            />
          );
        })}
      </div>
    </div>
  );
}
