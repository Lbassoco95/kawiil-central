import { FormEvent, KeyboardEvent, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, SendHorizontal, Smile, AtSign, CalendarClock, Paperclip, Mic, Square, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { SLACK_EMOJI } from "@/lib/slackFormatting";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { slackUserDisplayName } from "./slackGrouping";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EMOJI_PICKER_KEYS = Object.keys(SLACK_EMOJI).slice(0, 48);

const MENTION_LIST_CAP = 120;

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Slack reproduce bien AAC/M4A; WebM/Opus a veces se sube pero no suena en algunos clientes. Preferir MP4 cuando MediaRecorder lo permita. */
const VOICE_RECORD_MIME_PRIORITY = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

function pickVoiceRecorderMime(): string | null {
  for (const mime of VOICE_RECORD_MIME_PRIORITY) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function extensionAndTypeForVoiceBlob(mime: string): { ext: string; type: string } {
  const m = mime.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) {
    return { ext: "m4a", type: m.startsWith("audio/") ? mime.split(";")[0].trim() : "audio/mp4" };
  }
  if (m.includes("webm")) {
    return { ext: "webm", type: "audio/webm" };
  }
  if (m.includes("ogg")) {
    return { ext: "ogg", type: "audio/ogg" };
  }
  return { ext: "webm", type: mime.split(";")[0].trim() || "application/octet-stream" };
}

function defaultScheduleLocalValue(): string {
  const d = new Date(Date.now() + 3600_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type AiImproveMode = "improve" | "shorter" | "formal" | "friendly";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  channelLabel?: string;
  mentionUserIds?: string[];
  userMap?: Record<string, SlackUserProfile | undefined>;
  compact?: boolean;
  /** `messageText` es el borrador actual del compositor (incl. hilo). Puede devolver una promesa. */
  onSchedule?: (postAtUnixSeconds: number, messageText: string) => void | Promise<void>;
  scheduling?: boolean;
  onUploadFile?: (file: File, initialComment?: string) => void;
  uploading?: boolean;
  showRestoreDraft?: boolean;
  onRestoreDraft?: () => void;
  /**
   * Si se provee, habilita el botón "Mejorar con AI". Debe llamar a la edge
   * `slack-ai-improve` y retornar el texto reescrito (o lanzar Error).
   */
  onImproveWithAi?: (draft: string, mode: AiImproveMode) => Promise<string>;
};

const KAWIIL_AI_GRADIENT = "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";

export function SlackComposer({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  channelLabel,
  mentionUserIds = [],
  userMap = {},
  compact,
  onSchedule,
  scheduling,
  onUploadFile,
  uploading,
  showRestoreDraft,
  onRestoreDraft,
  onImproveWithAi,
}: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionSearchInputRef = useRef<HTMLInputElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  /** Filtro del cuadro de búsqueda del popover (no reescribe el @ en el textarea hasta elegir). */
  const [mentionOverrideFilter, setMentionOverrideFilter] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleLocal, setScheduleLocal] = useState(defaultScheduleLocalValue);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState<AiImproveMode | null>(null);
  const [aiUndo, setAiUndo] = useState<string | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording" | "stopped">("idle");
  const recChunksRef = useRef<BlobPart[]>([]);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** MIME real de la grabación (el Blob debe coincidir; antes se forzaba webm y Safari/MP4 quedaba corrupto para Slack). */
  const recMimeRef = useRef<string>("");

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 160)}px`;
  }, [value, compact]);

  useEffect(() => {
    return () => {
      mediaRecRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!mentionOpen) {
      setMentionOverrideFilter(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      mentionSearchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [mentionOpen]);

  const submit = () => {
    const t = value.trim();
    if (!t || sending || disabled) return;
    onSend();
  };

  const insertAtCursor = (snippet: string) => {
    const el = ta.current;
    if (!el) {
      onChange(value + snippet);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const effectiveMentionFilter = mentionOverrideFilter ?? mentionFilter;

  const filteredMentions = useMemo(() => {
    const q = effectiveMentionFilter.toLowerCase();
    const rows = mentionUserIds
      .map((id) => {
        const label = slackUserDisplayName(id, userMap);
        const name = label.toLowerCase();
        const idLower = id.toLowerCase();
        if (q && !name.includes(q) && !idLower.includes(q)) return null;
        let score = 4;
        if (!q) score = 0;
        else if (name.startsWith(q)) score = 0;
        else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 1;
        else if (idLower.startsWith(q)) score = 2;
        else score = 3;
        return { id, score, label };
      })
      .filter((x): x is { id: string; score: number; label: string } => x != null)
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
      )
      .slice(0, MENTION_LIST_CAP)
      .map((x) => x.id);
    return rows;
  }, [mentionUserIds, effectiveMentionFilter, userMap]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onChangeTextarea = (v: string) => {
    onChange(v);
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = v.slice(0, pos);
    const at = before.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /[\s\n]/.test(before[at - 1]))) {
      const frag = before.slice(at + 1);
      if (!frag.includes(" ") && frag.length <= 80) {
        setMentionFilter(frag);
        setMentionOverrideFilter(null);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
  };

  const pickMention = (id: string) => {
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = value.slice(0, pos);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    const next = value.slice(0, at) + `<@${id}> ` + value.slice(pos);
    onChange(next);
    setMentionOpen(false);
    setMentionOverrideFilter(null);
    requestAnimationFrame(() => {
      el.focus();
      const p = at + id.length + 4;
      el.setSelectionRange(p, p);
    });
  };

  const onSubmitForm = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !onUploadFile) return;
    if (f.size > MAX_FILE_BYTES) {
      toast.error("El archivo supera 50 MB");
      return;
    }
    const cap = value.trim() || undefined;
    onUploadFile(f, cap);
  };

  const stopRecording = useCallback(() => {
    mediaRecRef.current?.stop();
    mediaRecRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = async () => {
    if (!onUploadFile || disabled || sending || uploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickVoiceRecorderMime();
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        toast.error("Tu navegador no permite grabar audio en un formato compatible. Prueba con Chrome, Edge o Safari actualizado.");
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecRef.current = rec;
      recMimeRef.current = rec.mimeType || mime;
      recChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        setRecState("stopped");
      };
      rec.start(250);
      setRecState("recording");
    } catch {
      setRecState("idle");
      toast.error("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
    }
  };

  const cancelRecording = () => {
    stopRecording();
    recChunksRef.current = [];
    recMimeRef.current = "";
    setRecState("idle");
  };

  const sendRecording = () => {
    const parts = recChunksRef.current;
    if (!onUploadFile || parts.length === 0) {
      cancelRecording();
      return;
    }
    const mime = recMimeRef.current || pickVoiceRecorderMime() || "audio/webm";
    const { ext, type } = extensionAndTypeForVoiceBlob(mime);
    const blob = new Blob(parts, { type });
    const file = new File([blob], `nota-voz-${Date.now()}.${ext}`, { type: blob.type });
    stopRecording();
    recChunksRef.current = [];
    recMimeRef.current = "";
    setRecState("idle");
    const cap = value.trim() ? value.trim() : "Nota de voz";
    onUploadFile(file, cap);
  };

  const applySchedule = () => {
    if (!onSchedule) return;
    const d = new Date(scheduleLocal);
    if (Number.isNaN(d.getTime())) {
      toast.error("Fecha u hora no válida");
      return;
    }
    const now = Date.now();
    const postAt = Math.floor(d.getTime() / 1000);
    const min = Math.floor(now / 1000) + 90;
    if (postAt < min) {
      toast.error("Elige una hora al menos 90 segundos en el futuro");
      return;
    }
    const msg = value.trim();
    if (!msg) {
      toast.error("Escribe un mensaje para programar");
      return;
    }
    void (async () => {
      try {
        await Promise.resolve(onSchedule(postAt, msg));
        setScheduleOpen(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo programar");
      }
    })();
  };

  const placeholder = channelLabel
    ? `Escribe un mensaje en ${channelLabel.includes("#") || channelLabel.length < 2 ? channelLabel : `«${channelLabel}»`}…`
    : "Escribe un mensaje…";

  const busy = disabled || sending || scheduling || uploading;

  const iconBtnClass = compact ? "h-8 w-8 shrink-0 rounded-md" : "h-9 w-9 shrink-0 rounded-lg";
  const iconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  const runImprove = async (mode: AiImproveMode) => {
    if (!onImproveWithAi) return;
    const draft = value.trim();
    if (!draft) {
      toast.error("Escribe primero un borrador");
      return;
    }
    setAiBusy(mode);
    try {
      const previous = value;
      const improved = await onImproveWithAi(draft, mode);
      if (typeof improved === "string" && improved.trim()) {
        setAiUndo(previous);
        onChange(improved);
        toast.success(
          mode === "shorter"
            ? "Versión más corta lista"
            : mode === "formal"
              ? "Versión más formal lista"
              : mode === "friendly"
                ? "Versión más amigable lista"
                : "Borrador mejorado",
        );
        setAiOpen(false);
      } else {
        toast.error("No se pudo mejorar el mensaje");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error mejorando con AI");
    } finally {
      setAiBusy(null);
    }
  };

  const undoImprove = () => {
    if (aiUndo == null) return;
    onChange(aiUndo);
    setAiUndo(null);
    toast.success("Restaurado el borrador anterior");
  };

  return (
    <form
      onSubmit={onSubmitForm}
      className={cn("shrink-0 border-t border-border/80 bg-muted/20", compact ? "p-2" : "p-3")}
    >
      <input
        ref={fileInputRef}
        id="comunicacion-slack-adjunto"
        name="slack_adjunto"
        type="file"
        className="hidden"
        onChange={onPickFile}
        accept="*/*"
      />
      {aiUndo != null && (
        <div
          className={cn(
            "mx-auto mb-2 flex items-center justify-between gap-3 rounded-lg border border-sky-200/60 bg-gradient-to-r from-sky-50 to-blue-50 px-3 py-1.5 text-[11px] text-sky-800 shadow-sm",
            "dark:border-sky-800/40 dark:from-sky-950/30 dark:to-blue-950/20 dark:text-sky-200",
            compact ? "max-w-none" : "max-w-4xl",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Borrador mejorado por Kawiil AI
          </span>
          <button
            type="button"
            className="font-semibold hover:underline"
            onClick={undoImprove}
          >
            Deshacer
          </button>
        </div>
      )}
      <div
        className={cn(
          "mx-auto flex flex-nowrap gap-1 sm:gap-1.5 items-end min-w-0 rounded-xl border border-border/80 bg-background shadow-sm px-1.5 py-1.5 sm:px-2 sm:py-2 focus-within:ring-1 focus-within:ring-primary/25",
          compact ? "max-w-none" : "max-w-4xl",
        )}
      >
        <div className="flex shrink-0 items-end gap-0.5">
        <Popover
          open={mentionOpen}
          onOpenChange={(o) => {
            setMentionOpen(o);
            if (!o) setMentionOverrideFilter(null);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconBtnClass}
              disabled={busy}
              onClick={() => {
                insertAtCursor("@");
                setMentionFilter("");
                setMentionOverrideFilter(null);
                setMentionOpen(true);
              }}
            >
              <AtSign className={iconClass} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start" side="top">
            <p className="text-[10px] text-muted-foreground px-0.5 pb-1.5">Mencionar</p>
            <Input
              ref={mentionSearchInputRef}
              className="h-8 text-sm mb-2"
              placeholder="Buscar por nombre…"
              value={mentionOverrideFilter !== null ? mentionOverrideFilter : mentionFilter}
              onChange={(e) => setMentionOverrideFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMentionOpen(false);
              }}
            />
            <ul className="max-h-60 overflow-y-auto -mx-0.5">
              {filteredMentions.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
                    onClick={() => pickMention(id)}
                  >
                    {slackUserDisplayName(id, userMap)}
                  </button>
                </li>
              ))}
              {filteredMentions.length === 0 && (
                <li className="text-xs text-muted-foreground px-2 py-2">Sin coincidencias</li>
              )}
            </ul>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={iconBtnClass} disabled={busy}>
              <Smile className={iconClass} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start" side="top">
            <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
              {EMOJI_PICKER_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="text-lg p-1 rounded hover:bg-muted"
                  title={`:${k}:`}
                  onClick={() => insertAtCursor(`:${k}:`)}
                >
                  {SLACK_EMOJI[k]}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {onUploadFile && compact && recState === "idle" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={iconBtnClass}
                disabled={busy}
                title="Adjuntos y voz"
              >
                {uploading ? <Loader2 className={`${iconClass} animate-spin`} /> : <Paperclip className={iconClass} />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={busy || uploading}
                onSelect={() => {
                  window.setTimeout(() => fileInputRef.current?.click(), 0);
                }}
              >
                Adjuntar archivo…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={() => void startRecording()}>
                Nota de voz…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onUploadFile && !compact && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconBtnClass}
            disabled={busy}
            title="Adjuntar archivo (máx. 50 MB)"
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className={`${iconClass} animate-spin`} /> : <Paperclip className={iconClass} />}
          </Button>
        )}
        {onUploadFile && !compact && (
          <>
            {recState === "recording" ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className={iconBtnClass}
                onClick={stopRecording}
                title="Detener grabación"
              >
                <Square className={iconClass} />
              </Button>
            ) : recState === "stopped" ? (
              <>
                <Button type="button" variant="secondary" size="sm" className="shrink-0 h-9 text-xs px-2" onClick={cancelRecording}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" className="shrink-0 h-9 text-xs px-2" onClick={sendRecording}>
                  Enviar nota
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={iconBtnClass}
                disabled={busy}
                title="Grabar nota de voz"
                onClick={() => void startRecording()}
              >
                <Mic className={iconClass} />
              </Button>
            )}
          </>
        )}
        {onUploadFile && compact && recState === "recording" && (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className={iconBtnClass}
            onClick={stopRecording}
            title="Detener grabación"
          >
            <Square className={iconClass} />
          </Button>
        )}
        {onUploadFile && compact && recState === "stopped" && (
          <>
            <Button type="button" variant="secondary" size="sm" className="shrink-0 h-8 text-xs px-2" onClick={cancelRecording}>
              Cancelar
            </Button>
            <Button type="button" size="sm" className="shrink-0 h-8 text-xs px-2" onClick={sendRecording}>
              Enviar nota
            </Button>
          </>
        )}
        {onSchedule && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconBtnClass}
              disabled={!value.trim() || busy}
              title="Programar envío"
              onClick={() => {
                setScheduleLocal(defaultScheduleLocalValue());
                setScheduleOpen(true);
              }}
            >
              {scheduling ? <Loader2 className={`${iconClass} animate-spin`} /> : <CalendarClock className={iconClass} />}
            </Button>
            <Dialog
              open={scheduleOpen}
              onOpenChange={(o) => {
                setScheduleOpen(o);
                if (o) setScheduleLocal(defaultScheduleLocalValue());
              }}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Programar mensaje en Slack</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    La hora es la de tu dispositivo. Slack exige al menos ~90 s en el futuro.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="slack-schedule-dt">Fecha y hora</Label>
                    <input
                      id="slack-schedule-dt"
                      name="slack_schedule_datetime"
                      type="datetime-local"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={scheduleLocal}
                      onChange={(e) => setScheduleLocal(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                    Cerrar
                  </Button>
                  <Button type="button" onClick={applySchedule} disabled={scheduling}>
                    {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Programar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
        {showRestoreDraft && onRestoreDraft && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconBtnClass}
            title="Restaurar borrador guardado"
            onClick={onRestoreDraft}
          >
            <RotateCcw className={iconClass} />
          </Button>
        )}
        </div>
        <Textarea
          ref={ta}
          id="comunicacion-slack-mensaje"
          name="slack_message_body"
          autoComplete="off"
          value={value}
          onChange={(e) => onChangeTextarea(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`${placeholder} (Enter envía, Shift+Enter nueva línea)`}
          disabled={busy}
          rows={1}
          className={cn(
            "min-w-0 flex-1 min-h-[36px] max-h-[160px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm py-2 sm:py-2.5",
            compact ? "max-h-[120px] min-h-[32px]" : "min-h-[40px]",
          )}
        />
        <div className="flex shrink-0 items-end gap-0.5">
        {onImproveWithAi && (
          <Popover open={aiOpen} onOpenChange={setAiOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                className={cn(
                  "shrink-0 rounded-lg gap-1 text-white shadow-sm hover:opacity-90",
                  compact ? "h-8 w-8 p-0" : "h-9 px-2.5 gap-1.5",
                )}
                style={{ background: KAWIIL_AI_GRADIENT }}
                disabled={busy || !value.trim()}
                title="Mejorar con Kawiil AI"
              >
                {aiBusy ? (
                  <Loader2 className={`${iconClass} animate-spin`} />
                ) : (
                  <Sparkles className={iconClass} />
                )}
                {!compact && (
                  <span className="hidden sm:inline text-[11px] font-semibold">Mejorar</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="end" side="top">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reescribir borrador
              </p>
              <div className="space-y-0.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-60"
                  disabled={!!aiBusy}
                  onClick={() => void runImprove("improve")}
                >
                  {aiBusy === "improve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5 text-sky-600" />
                  )}
                  <span>Mejorar redacción</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-60"
                  disabled={!!aiBusy}
                  onClick={() => void runImprove("shorter")}
                >
                  {aiBusy === "shorter" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                  )}
                  <span>Más corto</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-60"
                  disabled={!!aiBusy}
                  onClick={() => void runImprove("formal")}
                >
                  {aiBusy === "formal" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                  )}
                  <span>Más formal</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-60"
                  disabled={!!aiBusy}
                  onClick={() => void runImprove("friendly")}
                >
                  {aiBusy === "friendly" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                  )}
                  <span>Más amigable</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        <Button type="submit" size="icon" className={iconBtnClass} disabled={sending || disabled || !value.trim()}>
          {sending ? <Loader2 className={`${iconClass} animate-spin`} /> : <SendHorizontal className={iconClass} />}
        </Button>
        </div>
      </div>
    </form>
  );
}
