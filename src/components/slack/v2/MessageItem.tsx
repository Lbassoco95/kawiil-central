import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { fetchSlackPrivateFileBlob, type SlackMessage, type SlackFile } from "@/lib/slackApi";
import { slackMrkdwnToReact, slackEmojiAliasToChar, type FormatContext } from "@/lib/slackFormatting";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { SlackAttachmentPreviewDialog } from "@/components/slack/SlackAttachmentPreviewDialog";

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

// ─── FileCard ────────────────────────────────────────────────
function formatFileSize(size?: number): string {
  if (!size || !Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(f: SlackFile): boolean {
  if (f.mimetype?.startsWith("image/")) return true;
  const ext = (f.filetype || (f.name?.split(".").pop() ?? "")).toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext);
}

function FileCard({ f, onPreview }: { f: SlackFile; onPreview: (f: SlackFile) => void }) {
  const isImg = isImageFile(f);
  const privateUrl = f.url_private_download || f.url_private || "";
  const label = f.title || f.name || "Adjunto";
  const sizeLabel = formatFileSize(f.size);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Cleanup blob URL al desmontar
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // IntersectionObserver: solo activa la carga cuando la imagen es visible
  useEffect(() => {
    if (!isImg || !privateUrl) return;
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setIsVisible(true); obs.disconnect(); break; }
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isImg, privateUrl]);

  // Cargar blob cuando visible
  useEffect(() => {
    if (!isImg || !privateUrl || !isVisible || resolvedUrl) return;
    let cancelled = false;
    setLoading(true);
    fetchSlackPrivateFileBlob(privateUrl)
      .then((blob) => {
        if (cancelled) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setResolvedUrl(url);
      })
      .catch(() => { /* ignorar silenciosamente */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isImg, privateUrl, isVisible, resolvedUrl]);

  const handleOpen = useCallback(() => onPreview(f), [f, onPreview]);

  if (isImg) {
    return (
      <div ref={wrapperRef}>
        <button
          type="button"
          onClick={handleOpen}
          title="Ver imagen"
          style={{
            display: "block",
            padding: 0,
            border: "1px solid hsl(var(--border) / 0.6)",
            borderRadius: 8,
            overflow: "hidden",
            cursor: "pointer",
            background: "transparent",
            maxWidth: 280,
          }}
        >
          {resolvedUrl ? (
            <img
              src={resolvedUrl}
              alt={label}
              loading="lazy"
              decoding="async"
              style={{ display: "block", maxHeight: 220, maxWidth: 280, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 200,
                height: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "hsl(var(--muted) / 0.5)",
              }}
            >
              {loading ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                </svg>
              )}
            </div>
          )}
          <div style={{ padding: "4px 8px 6px", fontSize: 11, color: "hsl(var(--muted-foreground))", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}{sizeLabel ? ` · ${sizeLabel}` : ""}
          </div>
        </button>
      </div>
    );
  }

  // Tarjeta para documentos y otros tipos
  const ext = (f.filetype || (f.name?.split(".").pop() ?? "")).toLowerCase();
  const isPdf = f.mimetype === "application/pdf" || ext === "pdf";
  const isOffice = ["xlsx","xls","docx","doc","pptx","ppt"].includes(ext);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid hsl(var(--border) / 0.7)",
        borderRadius: 8,
        padding: "7px 10px",
        background: "hsl(var(--muted) / 0.3)",
        maxWidth: 320,
      }}
    >
      {/* Icono según tipo */}
      <div style={{ flexShrink: 0, color: isPdf ? "#e74c3c" : isOffice ? "#27ae60" : "hsl(var(--muted-foreground))" }}>
        {isPdf ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
        ) : isOffice ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        )}
      </div>

      {/* Nombre y tamaño */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </div>
        {sizeLabel && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{sizeLabel}</div>
        )}
      </div>

      {/* Botón abrir */}
      <button
        type="button"
        onClick={handleOpen}
        style={{
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 600,
          color: "hsl(var(--primary))",
          background: "transparent",
          border: "1px solid hsl(var(--primary) / 0.35)",
          borderRadius: 6,
          padding: "3px 8px",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        Abrir
      </button>
    </div>
  );
}

// ─── Componente ──────────────────────────────────────────────
interface Props {
  message: SlackMessage;
  isCompact?: boolean;
  userName?: string;
  avatarUrl?: string;
  isSelf?: boolean;
  userMap?: Record<string, SlackUserProfile | undefined>;
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
  userMap,
  onOpenThread,
  onReact,
  onSaveForLater,
}: Props) {
  const name = userName || message.user || message.bot_id || "Usuario";
  const initials = getInitials(name);
  const color = avatarColor(message.user || message.bot_id || "x");
  const time = formatTs(message.ts ?? "");
  const isBot = !!message.bot_id;

  const formatCtx = useMemo<FormatContext>(
    () => ({ userMap: userMap ?? {} }),
    [userMap],
  );

  const [previewFile, setPreviewFile] = useState<SlackFile | null>(null);

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
        <div className="sl-msg-text">
          {slackMrkdwnToReact(message.text ?? "", formatCtx)}
        </div>

        {/* Archivos adjuntos */}
        {message.files && message.files.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {message.files.map((f: SlackFile) => (
              <FileCard key={f.id || f.name} f={f} onPreview={setPreviewFile} />
            ))}
          </div>
        )}

        <SlackAttachmentPreviewDialog
          file={previewFile}
          open={previewFile !== null}
          onOpenChange={(open) => { if (!open) setPreviewFile(null); }}
        />

        {/* Reacciones */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="sl-reactions">
            {message.reactions.map((r: any) => (
              <button
                key={r.name}
                className="sl-react-pill"
                onClick={() => onReact?.(message.ts ?? "", r.name)}
              >
                {slackEmojiAliasToChar(r.name)} {r.count}
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
