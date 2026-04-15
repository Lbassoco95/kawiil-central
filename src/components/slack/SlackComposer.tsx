import { FormEvent, KeyboardEvent, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, SendHorizontal, Smile, AtSign, CalendarClock, Paperclip, Mic, Square, RotateCcw } from "lucide-react";
import { SLACK_EMOJI } from "@/lib/slackFormatting";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { slackUserDisplayName } from "./slackGrouping";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EMOJI_PICKER_KEYS = Object.keys(SLACK_EMOJI).slice(0, 48);

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
  onSchedule?: (postAtUnixSeconds: number) => void;
  scheduling?: boolean;
  onUploadFile?: (file: File, initialComment?: string) => void;
  uploading?: boolean;
  showRestoreDraft?: boolean;
  onRestoreDraft?: () => void;
};

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
}: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleLocal, setScheduleLocal] = useState(defaultScheduleLocalValue);
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

  const filteredMentions = useMemo(() => {
    const q = mentionFilter.toLowerCase();
    return mentionUserIds
      .filter((id) => {
        const name = slackUserDisplayName(id, userMap).toLowerCase();
        return !q || name.includes(q) || id.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [mentionUserIds, mentionFilter, userMap]);

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
      if (!frag.includes(" ") && frag.length <= 40) {
        setMentionFilter(frag);
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
    onSchedule(postAt);
    setScheduleOpen(false);
  };

  const placeholder = channelLabel
    ? `Escribe un mensaje en ${channelLabel.includes("#") || channelLabel.length < 2 ? channelLabel : `«${channelLabel}»`}…`
    : "Escribe un mensaje…";

  const busy = disabled || sending || scheduling || uploading;

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
      <div
        className={cn(
          "mx-auto flex gap-2 items-end rounded-xl border border-border/80 bg-background shadow-sm px-2 py-2 focus-within:ring-1 focus-within:ring-primary/25",
          compact ? "max-w-none" : "max-w-4xl",
        )}
      >
        <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-lg"
              disabled={busy}
              onClick={() => {
                insertAtCursor("@");
                setMentionFilter("");
                setMentionOpen(true);
              }}
            >
              <AtSign className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="start" side="top">
            <p className="text-[10px] text-muted-foreground px-2 py-1">Mencionar</p>
            <ul className="max-h-48 overflow-y-auto">
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
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-lg" disabled={busy}>
              <Smile className="h-4 w-4" />
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
        {onUploadFile && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-lg"
            disabled={busy}
            title="Adjuntar archivo (máx. 50 MB)"
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
        )}
        {onUploadFile && (
          <>
            {recState === "recording" ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-lg"
                onClick={stopRecording}
                title="Detener grabación"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : recState === "stopped" ? (
              <>
                <Button type="button" variant="secondary" size="sm" className="shrink-0 h-10" onClick={cancelRecording}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" className="shrink-0 h-10" onClick={sendRecording}>
                  Enviar nota
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-lg"
                disabled={busy}
                title="Grabar nota de voz"
                onClick={() => void startRecording()}
              >
                <Mic className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
        {onSchedule && (
          <Dialog
            open={scheduleOpen}
            onOpenChange={(o) => {
              setScheduleOpen(o);
              if (o) setScheduleLocal(defaultScheduleLocalValue());
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-lg"
              disabled={!value.trim() || busy}
              title="Programar envío"
              onClick={() => {
                setScheduleLocal(defaultScheduleLocalValue());
                setScheduleOpen(true);
              }}
            >
              {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            </Button>
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
        )}
        {showRestoreDraft && onRestoreDraft && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-lg"
            title="Restaurar borrador guardado"
            onClick={onRestoreDraft}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
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
            "min-h-[40px] max-h-[160px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm py-2.5",
            compact && "min-h-[36px] max-h-[120px]",
          )}
        />
        <Button type="submit" size="icon" className="shrink-0 h-10 w-10 rounded-lg" disabled={sending || disabled || !value.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  );
}
