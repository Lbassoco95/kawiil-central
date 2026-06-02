import { useRef, useEffect } from "react";
import type { SlackMessage } from "@/lib/slackApi";
import { MessageItem } from "./MessageItem";
import { SlackComposerNew } from "./SlackComposerNew";

interface Props {
  open: boolean;
  onClose: () => void;
  channelId: string;
  rootMessage: SlackMessage | null;
  replies: SlackMessage[];
  isLoading: boolean;
  isSending?: boolean;
  onSendReply: (text: string) => void;
  onReact?: (ts: string, emoji: string) => void;
  onCreateTask?: (msg: SlackMessage) => void;
  userMap?: Record<string, { display_name?: string; real_name?: string; avatar_url?: string }>;
  selfUserId?: string;
}

export function ThreadPanelNew({
  open,
  onClose,
  channelId: _channelId,
  rootMessage,
  replies,
  isLoading,
  isSending,
  onSendReply,
  onReact,
  onCreateTask,
  userMap = {},
  selfUserId,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll al fondo cuando llegan respuestas
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, replies.length]);


  const allMessages = rootMessage ? [rootMessage, ...replies] : replies;

  return (
    <>
      {/* Backdrop mobile */}
      <div
        className={`sl-thread-backdrop${open ? " open" : ""}`}
        onClick={onClose}
      />

      <div className={`sl-thread-panel${open ? " open" : ""}`}>
        {/* Cabecera */}
        <div className="sl-thread-head">
          <div className="sl-thread-title">
            <span className="sl-thread-eyebrow">Hilo</span>
            <h3>Respuestas</h3>
          </div>
          <div className="sl-thread-actions">
            <button className="sl-thread-btn" onClick={onClose} title="Cerrar hilo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Mensajes del hilo */}
        <div className="sl-thread-stream" ref={scrollRef}>
          {isLoading && (
            <div style={{ padding: 24, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              Cargando hilo…
            </div>
          )}

          {!isLoading && !rootMessage && (
            <div style={{ padding: 24, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              Selecciona un mensaje para ver el hilo.
            </div>
          )}

          {allMessages.map((msg, i) => {
            const uProfile = userMap[msg.user ?? ""];
            const isRoot = i === 0 && msg.ts === rootMessage?.ts;
            return (
              <div key={msg.ts}>
                {isRoot && replies.length > 0 && (
                  <div style={{
                    padding: "6px 16px",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "hsl(var(--muted-foreground))",
                    borderBottom: "1px solid hsl(var(--border))",
                    marginBottom: 8,
                  }}>
                    {replies.length} {replies.length === 1 ? "respuesta" : "respuestas"}
                  </div>
                )}
                <MessageItem
                  message={msg}
                  userName={uProfile?.display_name || uProfile?.real_name || msg.user}
                  avatarUrl={uProfile?.avatar_url}
                  isSelf={msg.user === selfUserId}
                  selfUserId={selfUserId}
                  userMap={userMap}
                  onReact={onReact}
                  onCreateTask={onCreateTask}
                />
              </div>
            );
          })}
        </div>

        {/* Composer del hilo — con @menciones */}
        <SlackComposerNew
          channelName="hilo"
          isSending={isSending}
          onSend={onSendReply}
          userMap={userMap}
        />
      </div>
    </>
  );
}
