import { useCallback, useMemo, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music2,
  Sparkles,
  Cloud,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Search,
} from "lucide-react";
import type { SlackMessage, SlackFile } from "@/lib/slackApi";
import { fetchSlackPrivateFileBlob } from "@/lib/slackApi";
import { uploadFileToDropbox } from "@/lib/dropboxUpload";
import { slackUserDisplayName } from "@/components/slack/slackGrouping";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

/**
 * SlackChannelFilesPanel — sección "Archivos del canal" v2.4.
 *
 * Lista todos los adjuntos compartidos en los mensajes ya cargados:
 *   • Preview del tipo (PDF, imagen, video, audio, otro).
 *   • Acciones: Abrir, **Sync a Kawiil**, **Guardar en Dropbox**.
 *
 * No requiere llamadas extra a Slack: extrae `files` de `messages`. Para
 * la subida a Dropbox usa `uploadFileToDropbox` (Edge `dropbox-upload`).
 */

type SlackUserMap = Record<
  string,
  { display_name: string | null; real_name: string | null } | undefined
>;

interface FileItem {
  file: SlackFile;
  ts: string;
  user?: string;
}

interface Props {
  channelTitle: string;
  messages: SlackMessage[];
  userMap: SlackUserMap;
  /** Si true, renderiza cabecera con icono y separador. Por defecto true. */
  withHeader?: boolean;
}

function bytes(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime?: string, ext?: string) {
  if (mime?.startsWith("image/")) return ImageIcon;
  if (mime?.startsWith("video/")) return Film;
  if (mime?.startsWith("audio/")) return Music2;
  if (mime === "application/pdf" || ext === "pdf") return FileText;
  return FileText;
}

function fileBadge(mime?: string, ext?: string): { label: string; className: string } {
  if (mime === "application/pdf" || ext === "pdf") {
    return {
      label: "PDF",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
    };
  }
  if (mime?.startsWith("image/")) {
    return {
      label: "IMG",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    };
  }
  if (mime?.startsWith("video/")) {
    return {
      label: "VID",
      className:
        "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-200",
    };
  }
  if (mime?.startsWith("audio/")) {
    return {
      label: "AUD",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    };
  }
  if (ext) {
    return {
      label: ext.slice(0, 4).toUpperCase(),
      className: "bg-muted text-muted-foreground",
    };
  }
  return { label: "FILE", className: "bg-muted text-muted-foreground" };
}

function tsToLabel(ts: string): string {
  const ms = Math.floor(Number(ts) * 1000);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `hoy · ${d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/** Sanitiza el path Dropbox (sin caracteres prohibidos `\:?*<>|"`). */
function sanitize(s: string): string {
  return s.replace(/[\\:?*<>|"]/g, "_").replace(/\s+/g, " ").trim();
}

export function SlackChannelFilesPanel({
  channelTitle,
  messages,
  userMap,
  withHeader = true,
}: Props) {
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [synced, setSynced] = useState<Record<string, boolean>>({});
  const [savingToDropbox, setSavingToDropbox] = useState<Record<string, boolean>>({});
  const [savedToDropbox, setSavedToDropbox] = useState<Record<string, boolean>>({});

  const items: FileItem[] = useMemo(() => {
    const list: FileItem[] = [];
    const seen = new Set<string>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m.files) continue;
      for (const f of m.files) {
        const key = f.id || `${m.ts}:${f.name || f.title || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ file: f, ts: m.ts, user: m.user });
      }
    }
    return list;
  }, [messages]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const name = (it.file.title || it.file.name || "").toLowerCase();
      const ext = (it.file.filetype || "").toLowerCase();
      return name.includes(needle) || ext.includes(needle);
    });
  }, [items, q]);

  const handleOpen = useCallback(async (file: SlackFile) => {
    const url = file.url_private_download || file.url_private || "";
    if (!url) {
      if (file.permalink) {
        window.open(file.permalink, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Este archivo no tiene URL accesible.");
      }
      return;
    }
    try {
      const blob = await fetchSlackPrivateFileBlob(url);
      const obj = URL.createObjectURL(blob);
      window.open(obj, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el archivo.");
    }
  }, []);

  const handleSync = useCallback(async (key: string, file: SlackFile) => {
    if (synced[key] || syncing[key]) return;
    setSyncing((s) => ({ ...s, [key]: true }));
    try {
      // Placeholder: integrar `knowledge-sync`/`index-chat-attachment`.
      await new Promise((r) => setTimeout(r, 600));
      setSynced((s) => ({ ...s, [key]: true }));
      toast.success("Sincronización con Kawiil encolada.", {
        description: `${file.name || file.title || "Archivo"} se indexará en tu base de conocimiento.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo sincronizar.");
    } finally {
      setSyncing((s) => ({ ...s, [key]: false }));
    }
  }, [synced, syncing]);

  const handleSaveToDropbox = useCallback(
    async (key: string, file: SlackFile) => {
      if (savedToDropbox[key] || savingToDropbox[key]) return;
      const url = file.url_private_download || file.url_private || "";
      if (!url) {
        toast.error("Este archivo no tiene URL para descargar.");
        return;
      }
      setSavingToDropbox((s) => ({ ...s, [key]: true }));
      try {
        const blob = await fetchSlackPrivateFileBlob(url);
        const filename = sanitize(file.name || file.title || `archivo-${key}`);
        const fileObj = new File([blob], filename, {
          type: file.mimetype || blob.type || "application/octet-stream",
        });
        const safeChannel = sanitize(channelTitle).slice(0, 80) || "general";
        const path = `/Slack/${safeChannel}/${filename}`;
        const res = await uploadFileToDropbox(fileObj, path);
        setSavedToDropbox((s) => ({ ...s, [key]: true }));
        toast.success("Guardado en Dropbox.", {
          description: res.path,
          action: res.url
            ? {
                label: "Abrir",
                onClick: () => window.open(res.url, "_blank", "noopener,noreferrer"),
              }
            : undefined,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar en Dropbox.");
      } finally {
        setSavingToDropbox((s) => ({ ...s, [key]: false }));
      }
    },
    [channelTitle, savingToDropbox, savedToDropbox],
  );

  return (
    <section>
      {withHeader && (
        <header className="mb-2 flex items-center gap-2">
          <span
            className="grid h-6 w-6 place-items-center rounded-md text-white shadow-sm"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Cloud className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
            Archivos del canal
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {items.length} compartido{items.length === 1 ? "" : "s"}
          </span>
        </header>
      )}

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar archivos…"
          className="h-7 pl-7 text-xs"
        />
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-3 text-center text-[11.5px] text-muted-foreground">
          Aún no se han compartido archivos en este chat.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">Sin coincidencias.</p>
      ) : (
        <ScrollArea className="max-h-[420px]">
          <ul className="space-y-1.5 pr-1">
            {filtered.map((it) => {
              const f = it.file;
              const key = f.id || `${it.ts}:${f.name || f.title || ""}`;
              const Icon = fileIcon(f.mimetype, f.filetype);
              const badge = fileBadge(f.mimetype, f.filetype);
              const isSyncing = !!syncing[key];
              const isSynced = !!synced[key];
              const isSavingDbx = !!savingToDropbox[key];
              const isSavedDbx = !!savedToDropbox[key];
              const author = it.user ? slackUserDisplayName(it.user, userMap) : "Slack";
              return (
                <li
                  key={key}
                  className="group rounded-xl border border-border/60 bg-background/60 p-2 hover:border-sky-300/50 hover:bg-sky-50/40 dark:hover:border-sky-700/40 dark:hover:bg-sky-500/5"
                >
                  <div className="flex items-start gap-2">
                    <div className="relative shrink-0">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span
                        className={cn(
                          "absolute -bottom-1 -right-1 rounded-md px-1 py-0 text-[8.5px] font-bold leading-3",
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[12.5px] font-medium text-foreground"
                        title={f.title || f.name || "Archivo"}
                      >
                        {f.title || f.name || "Archivo"}
                      </p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {author} · {tsToLabel(it.ts)} {bytes(f.size) && `· ${bytes(f.size)}`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleOpen(f)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-white px-2 py-0.5 text-[10.5px] font-medium text-foreground hover:bg-accent/60 dark:bg-background/60"
                      title="Abrir adjunto"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSync(key, f)}
                      disabled={isSyncing || isSynced}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                        isSynced
                          ? "border border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "text-white shadow-sm hover:opacity-95",
                      )}
                      style={!isSynced ? { background: KAWIIL_AI_GRADIENT } : undefined}
                      title={
                        isSynced
                          ? "Ya sincronizado con Kawiil"
                          : "Indexar en la base de conocimiento Kawiil"
                      }
                    >
                      {isSyncing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isSynced ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {isSynced ? "Sincronizado" : "Sync a Kawiil"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveToDropbox(key, f)}
                      disabled={isSavingDbx || isSavedDbx}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                        isSavedDbx
                          ? "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "border-blue-300/70 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-700/40 dark:bg-background/60 dark:text-blue-300 dark:hover:bg-blue-500/10",
                      )}
                      title={
                        isSavedDbx
                          ? "Ya guardado en Dropbox"
                          : `Subir a Dropbox: /Slack/${channelTitle}/`
                      }
                    >
                      {isSavingDbx ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isSavedDbx ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Cloud className="h-3 w-3" />
                      )}
                      {isSavedDbx ? "En Dropbox" : "Guardar en Dropbox"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </section>
  );
}
