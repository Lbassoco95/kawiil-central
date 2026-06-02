import { useState, useRef, useCallback, useEffect } from "react";

interface UserSuggestion {
  id: string;
  display_name: string | null;
  real_name: string | null;
  avatar_url?: string | null;
}

interface Props {
  channelName?: string;
  isSending?: boolean;
  onSend: (text: string, files?: File[]) => void;
  disabled?: boolean;
  userMap?: Record<string, UserSuggestion | undefined>;
  onTyping?: () => void;
}

export function SlackComposerNew({ channelName, isSending, onSend, disabled, userMap = {}, onTyping }: Props) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(() => {
    const val = inputRef.current?.innerText?.trim() || text.trim();
    if (!val || isSending || disabled) return;
    onSend(val);
    setText("");
    if (inputRef.current) inputRef.current.innerText = "";
    setMentionQuery(null);
  }, [text, isSending, disabled, onSend]);

  // Detectar @menciones mientras escribe
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const raw = (e.target as HTMLDivElement).innerText;
    setText(raw);
    // Emitir evento de escritura al hook de typing
    if (raw.trim()) onTyping?.();

    // Detectar si el cursor está justo después de un '@'
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setMentionQuery(null); return; }
    const range = sel.getRangeAt(0);
    const text = range.startContainer.textContent ?? "";
    const pos = range.startOffset;
    const before = text.slice(0, pos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) { setMentionQuery(null); return; }
    const query = before.slice(atIdx + 1);
    // Cerrar si hay espacio después de @
    if (query.includes(" ")) { setMentionQuery(null); return; }
    setMentionQuery(query);
    setMentionIndex(0);
  }, []);

  // Filtrar usuarios según el query
  const suggestions = mentionQuery !== null
    ? Object.entries(userMap)
        .filter(([, p]) => {
          if (!p) return false;
          const name = (p.display_name || p.real_name || "").toLowerCase();
          return name.includes(mentionQuery.toLowerCase());
        })
        .slice(0, 6)
        .map(([id, p]) => ({ id, ...(p as UserSuggestion) }))
    : [];

  const insertMention = useCallback((user: UserSuggestion & { id: string }) => {
    const label = user.display_name || user.real_name || user.id;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !inputRef.current) return;

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;
    const rawText = node.textContent ?? "";
    const atIdx = rawText.lastIndexOf("@", offset - 1);

    if (atIdx !== -1 && node.nodeType === Node.TEXT_NODE) {
      // Reemplazar "@query" con "@label"
      const before = rawText.slice(0, atIdx);
      const after = rawText.slice(offset);
      const newText = `${before}@${label} ${after}`;
      node.textContent = newText;

      // Mover cursor al final de la mención
      const newRange = document.createRange();
      newRange.setStart(node, atIdx + label.length + 2);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    setMentionQuery(null);
    setText(inputRef.current.innerText);
    inputRef.current.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions[mentionIndex];
        if (s) insertMention(s);
        return;
      }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const placeholder = channelName
    ? `Mensaje ${channelName.startsWith("#") ? channelName : `#${channelName}`}`
    : "Escribe un mensaje…";

  return (
    <div className="sl-compose" style={{ position: "relative" }}>
      {/* Popup de autocompletado @menciones */}
      {suggestions.length > 0 && (
        <div className="sl-mention-popup">
          {suggestions.map((s, i) => {
            const name = s.display_name || s.real_name || s.id;
            return (
              <button
                key={s.id}
                className={`sl-mention-item${i === mentionIndex ? " active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(s); }}
              >
                {s.avatar_url ? (
                  <img src={s.avatar_url} alt={name} className="sl-mention-av" />
                ) : (
                  <span className="sl-mention-av sl-mention-av--initials">
                    {name.substring(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="sl-mention-name">{name}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="sl-compose-box">
        {/* Barra de formato */}
        <div className="sl-compose-fmt">
          <button className="sl-fmt-btn" title="Negrita">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
            </svg>
          </button>
          <button className="sl-fmt-btn" title="Cursiva">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
            </svg>
          </button>
          <button className="sl-fmt-btn" title="Tachado">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>
            </svg>
          </button>
          <span className="sl-fmt-sep"/>
          <button className="sl-fmt-btn" title="Lista">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button className="sl-fmt-btn" title="Código">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
          </button>
        </div>

        {/* Input */}
        <div
          ref={inputRef}
          className="sl-compose-input"
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
        />

        {/* Pie: adjuntos + enviar */}
        <div className="sl-compose-foot">
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button className="sl-foot-btn" title="Adjuntar archivo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button className="sl-foot-btn" title="Emoji">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
            </button>
            <button className="sl-foot-btn ai" title="Redactar con IA" style={{ color: "hsl(var(--primary))" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
                <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
              </svg>
              IA
            </button>
          </div>

          <button
            className="sl-send"
            disabled={disabled || isSending || (!text.trim())}
            onClick={handleSend}
            title="Enviar"
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
          </button>
        </div>
      </div>
    </div>
  );
}
