import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listStandardSlackEmoji, type SlackCustomEmojiMap } from "@/lib/slackFormatting";
import {
  formatSlackEmojiUploadError,
  slackEmojiNameFromFile,
  validateSlackEmojiUpload,
} from "@/lib/slackEmojiUpload";
import { invokeSlackFileUpload } from "@/lib/slackApi";
import { SLACK_CUSTOM_EMOJI_QUERY_KEY } from "@/hooks/useSlackCustomEmoji";

type Tab = "workspace" | "standard";

interface Props {
  open: boolean;
  onClose: () => void;
  customEmoji: SlackCustomEmojiMap;
  loading?: boolean;
  error?: string | null;
  onSync: () => void;
  /** Inserta en el compositor: unicode o `:nombre:`. */
  onInsert?: (token: string) => void;
}

export function SlackEmojiLibrary({
  open,
  onClose,
  customEmoji,
  loading = false,
  error = null,
  onSync,
  onInsert,
}: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("workspace");
  const [query, setQuery] = useState("");
  const [alias, setAlias] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const q = query.trim().toLowerCase().replace(/:/g, "");
  const customEntries = useMemo(() => {
    const rows = Object.entries(customEmoji).sort(([a], [b]) => a.localeCompare(b));
    if (!q) return rows;
    return rows.filter(([name]) => name.includes(q));
  }, [customEmoji, q]);

  const standardEntries = useMemo(() => {
    const all = listStandardSlackEmoji();
    if (!q) return all.slice(0, 120);
    return all.filter((entry) => entry.name.includes(q)).slice(0, 200);
  }, [q]);

  const missingScope = !!error && error.toLowerCase().includes("missing_scope");

  const pickFile = (next: File | null) => {
    setFile(next);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    if (next && !alias.trim()) setAlias(slackEmojiNameFromFile(next.name));
  };

  const upload = async () => {
    if (!file) {
      toast.error("Cuando puedas, elige una imagen");
      return;
    }
    const name = alias.trim().toLowerCase();
    const problem = validateSlackEmojiUpload(name, file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("action", "emoji.add");
      body.append("name", name);
      body.append("file", file, file.name);
      const result = (await invokeSlackFileUpload(body)) as { ok?: boolean; error?: string };
      if (!result.ok) throw new Error(formatSlackEmojiUploadError(result.error));
      toast.success("El emoji ya está en Slack");
      setFile(null);
      setAlias("");
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      await queryClient.invalidateQueries({ queryKey: SLACK_CUSTOM_EMOJI_QUERY_KEY });
      onSync();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No pudimos subir el emoji";
      toast.error(message.startsWith("No pudimos") ? message : `No pudimos subir el emoji: ${message}`);
    } finally {
      setUploading(false);
    }
  };

  const insertCustom = (name: string) => {
    onInsert?.(`:${name}: `);
  };
  const insertStandard = (emoji: string) => {
    onInsert?.(`${emoji} `);
  };

  return (
    <div
      className={`emoji-modal-backdrop${open ? " open" : ""}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="emoji-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slack-emoji-library-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="emoji-modal-head">
          <div className="emoji-modal-head-icon" aria-hidden>
            🙂
          </div>
          <div>
            <div id="slack-emoji-library-title" className="emoji-modal-title">
              Emojis
            </div>
            <div className="emoji-modal-subtitle">
              Los del workspace son los que se suben en Slack. Los estándar usan el catálogo más reciente.
            </div>
          </div>
          <button type="button" className="emoji-modal-close" onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="emoji-sync">
          <div className="emoji-sync-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </div>
          <div className="emoji-sync-body">
            <div className="emoji-sync-title">
              <span className="dot" />
              {Object.keys(customEmoji).length} emojis del workspace
            </div>
            <div className="emoji-sync-sub">
              {missingScope
                ? "Falta el permiso emoji:read. Actualiza los permisos de Slack y vuelve a aceptar."
                : error
                  ? error
                  : loading
                    ? "Sincronizando con Slack…"
                    : "Se actualizan solos cada un rato. Sincroniza si acabas de subir uno en Slack."}
            </div>
          </div>
          <button type="button" className="emoji-sync-btn" onClick={onSync} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Sincronizar
          </button>
        </div>

        <div className="emoji-modal-body">
          {tab === "workspace" && (
            <div className="emoji-upload">
              <button
                type="button"
                className="emoji-drop"
                onClick={() => fileRef.current?.click()}
              >
                {preview ? (
                  <img src={preview} alt="" className="emoji-drop-preview" />
                ) : (
                  <div className="emoji-drop-emo">🖼️</div>
                )}
                <div className="emoji-drop-title">{file ? file.name : "Subir imagen"}</div>
                <div className="emoji-drop-sub">PNG, JPG o GIF · menos de 128 KB</div>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif"
                hidden
                onChange={(event) => {
                  pickFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <div className="emoji-alias">
                <div className="emoji-alias-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 7h16M4 12h10M4 17h7" />
                  </svg>
                  Nombre en Slack
                </div>
                <div className="emoji-alias-sub">Así se escribe: :{alias.trim().toLowerCase() || "nombre"}:</div>
                <div className="emoji-alias-row">
                  <input
                    value={alias}
                    onChange={(event) => setAlias(event.target.value)}
                    placeholder="nombre_del_emoji"
                    aria-label="Nombre del emoji"
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => void upload()} disabled={uploading || !file}>
                    {uploading ? "Subiendo…" : "Subir"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="emoji-toolbar">
            <div className="emoji-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tab === "workspace" ? "Buscar emoji del workspace" : "Buscar emoji estándar"}
                aria-label="Buscar emoji"
              />
            </div>
          </div>

          <div className="emoji-tabs">
            <button
              type="button"
              className={`emoji-tab${tab === "workspace" ? " active" : ""}`}
              onClick={() => setTab("workspace")}
            >
              Del workspace
              <span className="count">{Object.keys(customEmoji).length}</span>
            </button>
            <button
              type="button"
              className={`emoji-tab${tab === "standard" ? " active" : ""}`}
              onClick={() => setTab("standard")}
            >
              Estándar
            </button>
          </div>

          {tab === "workspace" ? (
            customEntries.length === 0 ? (
              <p className="emoji-empty">
                {q
                  ? "Ningún emoji del workspace coincide."
                  : "Todavía no hay emojis personalizados, o Slack no los ha compartido."}
              </p>
            ) : (
              <div className="emoji-grid">
                {customEntries.map(([name, url]) => (
                  <button
                    key={name}
                    type="button"
                    className="emoji-item"
                    onClick={() => insertCustom(name)}
                    title={`Insertar :${name}:`}
                  >
                    <span className="emoji-big">
                      <img src={url} alt="" className="emoji-big-img" />
                    </span>
                    <span className="emoji-body">
                      <span className="emoji-code">:{name}:</span>
                      <span className="emoji-meta">
                        <span className="emoji-src-pill slack">Slack</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="emoji-dense" role="list">
              {standardEntries.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  className="emoji-dense-btn"
                  title={`:${entry.name}:`}
                  onClick={() => insertStandard(entry.emoji)}
                >
                  <span className="sl-emoji">{entry.emoji}</span>
                </button>
              ))}
            </div>
          )}
          {tab === "standard" && !q && (
            <p className="emoji-empty">Mostrando los primeros. Escribe para buscar entre todo el catálogo.</p>
          )}
        </div>

        <div className="emoji-modal-foot">
          <div className="emoji-foot-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            Clic en un emoji para insertarlo en el mensaje.
          </div>
          <button type="button" className="emoji-foot-btn primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
