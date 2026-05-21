import { useState, useRef, useCallback, useEffect } from "react";
import type { SlackMessage } from "@/lib/slackApi";
import { MessageItem } from "./MessageItem";

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
  userMap?: Record<string, { display_name?: string; real_name?: string; avatar_url?: string }>;
  selfUserId?: string;
}

export function ThreadPanelNew({
  open,
  onClose,
  channelId,
  rootMessage,
  replies,
  isLoading,
  isSending,
  onSendReply,
  onReact,
  userMap = {},
  selfUserId,
}: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll al fondo cuando llegan respuestas
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, replies.length]);

  const handleSend = useCallback(() => {
    const val = inputRef.current?.innerText?.trim() || text.trim();
    if (!val || isSending) return;
    onSendReply(val);
    setText("");
    if (inputRef.current) inputRef.current.innerText = "";
  }, [text, isSending, onSendReply]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const rootUser = userMap[rootMessage?.user ?? ""];
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
                  userMap={userMap}
                  onReact={onReact}
                />
              </div>
            );
          })}
        </div>

        {/* Composer del hilo */}
        <footer className="sl-composer sl-composer-thread">
          <div className="sl-composer-format">
            <button className="sl-foot-btn" title="Negrita">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
              </svg>
            </button>
            <button className="sl-foot-btn" title="Cursiva">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
              </svg>
            </button>
            <button className="sl-foot-btn" title="Código">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
            </button>
          </div>

          <div
            ref={inputRef}
            className="sl-composer-input"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Responder al hilo… (Shift+↵ salto de línea)"
            onKeyDown={handleKeyDown}
            onInput={(e) => setText((e.target as HTMLDivElement).innerText)}
          />

          <div className="sl-composer-bottom">
            <div className="sl-composer-tools">
              <button className="sl-foot-btn" title="Adjuntar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <button className="sl-foot-btn" title="Emoji">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
                </svg>
              </button>
            </div>

            <div className="sl-composer-send">
              <button
                className="sl-send"
                disabled={isSending || !text.trim()}
                onClick={handleSend}
                title="Enviar respuesta"
              >
                {isSending ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                )}
                Enviar
              </button>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
