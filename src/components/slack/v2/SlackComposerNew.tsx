import { useState, useRef, useCallback, useMemo, useEffect } from "react";

/** Tamaño legible: 24 KB, 1.3 MB, etc. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

// Emoji rápidos para el picker simple
const QUICK_EMOJIS = ["😊","👍","❤️","🔥","✅","😂","🎉","👀","🙏","💪","😅","🤔","👏","🚀","💯","😍","🤝","📌","⚠️","❓"];

export function SlackComposerNew({ channelName, isSending, onSend, disabled, userMap = {}, onTyping }: Props) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const val = inputRef.current?.innerText?.trim() || text.trim();
    if ((!val && pendingFiles.length === 0) || isSending || disabled) return;
    onSend(val, pendingFiles.length > 0 ? pendingFiles : undefined);
    setText("");
    setPendingFiles([]);
    if (inputRef.current) inputRef.current.innerText = "";
    setMentionQuery(null);
    setShowEmojiPicker(false);
  }, [text, pendingFiles, isSending, disabled, onSend]);

  // ─── Formato de texto ────────────────────────────────────
  const applyFormat = (tag: "bold" | "italic" | "strike" | "code" | "list") => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const selected = range.toString();

    if (tag === "list") {
      // Insert bullet list item
      const lines = (selected || "elemento").split("\n").map((l) => `• ${l}`).join("\n");
      const node = document.createTextNode(lines);
      range.deleteContents();
      range.insertNode(node);
      sel.collapseToEnd();
      setText(el.innerText);
      return;
    }

    const wrappers: Record<string, [string, string]> = {
      bold: ["*", "*"],
      italic: ["_", "_"],
      strike: ["~", "~"],
      code: ["`", "`"],
    };
    const [open, close] = wrappers[tag];
    const wrapped = `${open}${selected || "texto"}${close}`;
    const node = document.createTextNode(wrapped);
    range.deleteContents();
    range.insertNode(node);
    // Move cursor to end of inserted text
    const newRange = document.createRange();
    newRange.setStartAfter(node);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    setText(el.innerText);
  };

  // ─── @menciones ─────────────────────────────────────────
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const raw = (e.target as HTMLDivElement).innerText;
    setText(raw);
    if (raw.trim()) onTyping?.();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setMentionQuery(null); return; }
    const range = sel.getRangeAt(0);
    const nodeText = range.startContainer.textContent ?? "";
    const pos = range.startOffset;
    const before = nodeText.slice(0, pos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) { setMentionQuery(null); return; }
    const query = before.slice(atIdx + 1);
    if (query.includes(" ")) { setMentionQuery(null); return; }
    setMentionQuery(query);
    setMentionIndex(0);
  }, [onTyping]);

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
      const before = rawText.slice(0, atIdx);
      const after = rawText.slice(offset);
      const newText = `${before}@${label} ${after}`;
      node.textContent = newText;
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

  // ─── Insertar emoji ──────────────────────────────────────
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(emoji);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.innerText += emoji;
    }
    setText(el.innerText);
    setShowEmojiPicker(false);
  };

  // ─── Archivos ────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingFiles((prev) => [...prev, ...files].slice(0, 5)); // max 5 files
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // Miniaturas para imágenes pendientes (objectURL); null para no-imágenes.
  const filePreviews = useMemo(
    () => pendingFiles.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [pendingFiles],
  );
  useEffect(() => {
    return () => filePreviews.forEach((u) => u && URL.revokeObjectURL(u));
  }, [filePreviews]);

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

  const canSend = !disabled && !isSending && (!!text.trim() || pendingFiles.length > 0);

  return (
    <div className="sl-compose" style={{ position: "relative" }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* @menciones popup */}
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

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 10,
          padding: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          width: 240,
          zIndex: 50,
          boxShadow: "0 4px 16px hsl(0 0% 0% / 0.12)",
          marginBottom: 6,
        }}>
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onMouseDown={(e) => { e.preventDefault(); insertEmoji(emoji); }}
              style={{ fontSize: 20, background: "transparent", border: 0, cursor: "pointer", width: 36, height: 36, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(var(--accent))")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="sl-compose-box">
        {/* Barra de formato */}
        <div className="sl-compose-fmt">
          <button className="sl-fmt-btn" title="Negrita (Ctrl+B)" onMouseDown={(e) => { e.preventDefault(); applyFormat("bold"); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
            </svg>
          </button>
          <button className="sl-fmt-btn" title="Cursiva" onMouseDown={(e) => { e.preventDefault(); applyFormat("italic"); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
            </svg>
          </button>
          <button className="sl-fmt-btn" title="Tachado" onMouseDown={(e) => { e.preventDefault(); applyFormat("strike"); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>
            </svg>
          </button>
          <span className="sl-fmt-sep"/>
          <button className="sl-fmt-btn" title="Lista" onMouseDown={(e) => { e.preventDefault(); applyFormat("list"); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button className="sl-fmt-btn" title="Código inline" onMouseDown={(e) => { e.preventDefault(); applyFormat("code"); }}>
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

        {/* Archivos pendientes (con miniatura para imágenes + tamaño) */}
        {pendingFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 12px 0" }}>
            {pendingFiles.map((f, i) => {
              const preview = filePreviews[i];
              return (
                <div key={i} style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 8,
                  background: "hsl(var(--muted))", borderRadius: 8,
                  padding: preview ? 4 : "6px 26px 6px 8px", color: "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))", maxWidth: 220,
                }}>
                  {preview ? (
                    <img
                      src={preview}
                      alt={f.name}
                      style={{ width: 40, height: 40, borderRadius: 5, objectFit: "cover", flexShrink: 0, display: "block" }}
                    />
                  ) : (
                    <span style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 32, height: 32, borderRadius: 5, flexShrink: 0,
                      background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </span>
                  )}
                  <div style={{ minWidth: 0, paddingRight: preview ? 20 : 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: preview ? 120 : 130 }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                      {formatFileSize(f.size)}
                    </div>
                  </div>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); removeFile(i); }}
                    title="Quitar"
                    style={{
                      position: "absolute", top: 2, right: 2,
                      width: 18, height: 18, borderRadius: "50%",
                      background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
                      cursor: "pointer", color: "hsl(var(--muted-foreground))",
                      padding: 0, lineHeight: 1, fontSize: 13,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Pie: adjuntos + enviar */}
        <div className="sl-compose-foot">
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="sl-foot-btn"
              title="Adjuntar archivo"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button
              className="sl-foot-btn"
              title="Emoji"
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              disabled={disabled}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
            </button>
          </div>

          <button
            className="sl-send"
            disabled={!canSend}
            onClick={handleSend}
            title="Enviar (Enter)"
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
