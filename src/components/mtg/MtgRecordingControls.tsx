/**
 * Guardar grabación de la junta: audio, pantalla+audio, o subir archivo.
 * Tras guardar, puede pedir transcripción OpenAI (multiidioma → español).
 * Muestra barra de progreso de la revisión (subida → transcripción).
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Mic,
  Monitor,
  Square,
  Upload,
  CheckCircle2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import {
  canUploadRecording,
  uploadMeetingRecording,
} from "@/lib/mtg/uploadRecording";
import { requestRecordingTranscription } from "@/lib/mtg/requestRecordingTranscription";

type CaptureMode = "audio" | "av";

/** Fases visibles de la revisión post-audio (independiente del status «En curso» de la junta). */
type ReviewPhase =
  | "idle"
  | "recording"
  | "uploading"
  | "transcribing"
  | "done"
  | "error";

const PHASE_META: Record<
  Exclude<ReviewPhase, "idle">,
  { label: string; detail: string; value: number }
> = {
  recording: {
    label: "Grabando",
    detail: "La junta sigue «En curso» hasta que pulses Terminar junta.",
    value: 12,
  },
  uploading: {
    label: "Subiendo grabación",
    detail: "Audio detenido. Guardando el archivo en la junta…",
    value: 40,
  },
  transcribing: {
    label: "Transcribiendo con IA",
    detail:
      "Revisando el audio (hasta ~3 h; se parte en trozos si pesa mucho). Multiidioma → español…",
    value: 72,
  },
  done: {
    label: "Revisión de audio lista",
    detail: "Transcripción guardada. La junta sigue «En curso» hasta Terminar junta.",
    value: 100,
  },
  error: {
    label: "No se pudo completar la revisión",
    detail: "Puedes reintentar «Transcribir IA» o subir un .vtt/.txt manualmente.",
    value: 100,
  },
};

async function buildCaptureStream(mode: CaptureMode): Promise<{
  stream: MediaStream;
  stopExtras: () => void;
}> {
  if (mode === "audio") {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return {
      stream,
      stopExtras: () => stream.getTracks().forEach((t) => t.stop()),
    };
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Este navegador no permite capturar pantalla");
  }

  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 },
    audio: true,
  });

  let mic: MediaStream | null = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    /* mic opcional si ya hay audio de pestaña */
  }

  const audioTracks: MediaStreamTrack[] = [];
  const stopExtras = () => {
    display.getTracks().forEach((t) => t.stop());
    mic?.getTracks().forEach((t) => t.stop());
    audioTracks.forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
  };

  const hasDisplayAudio = display.getAudioTracks().length > 0;
  const hasMic = !!mic && mic.getAudioTracks().length > 0;
  let outAudio: MediaStreamTrack[] = [];

  if (hasDisplayAudio && hasMic && typeof AudioContext !== "undefined") {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
    ctx.createMediaStreamSource(mic!).connect(dest);
    outAudio = dest.stream.getAudioTracks();
    audioTracks.push(...outAudio);
    const prevStop = stopExtras;
    return {
      stream: new MediaStream([...display.getVideoTracks(), ...outAudio]),
      stopExtras: () => {
        prevStop();
        void ctx.close();
      },
    };
  }

  if (hasMic) outAudio = mic!.getAudioTracks();
  else if (hasDisplayAudio) outAudio = display.getAudioTracks();

  return {
    stream: new MediaStream([...display.getVideoTracks(), ...outAudio]),
    stopExtras,
  };
}

function formatElapsed(sec: number): string {
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function MtgRecordingControls(props: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  onDone?: () => void;
  size?: "sm" | "default";
  /** Tras guardar, lanzar STT OpenAI (default true). */
  autoTranscribe?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const stopExtrasRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pulse, setPulse] = useState(0);
  const autoTranscribe = props.autoTranscribe !== false;

  const recording = phase === "recording";
  const processing = phase === "uploading" || phase === "transcribing";
  const showPanel = phase !== "idle";

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  // Barra “viva” mientras sube/transcribe (sin % real del servidor).
  useEffect(() => {
    if (!processing) return;
    const t = window.setInterval(() => setPulse((p) => p + 1), 800);
    return () => window.clearInterval(t);
  }, [processing]);

  useEffect(() => {
    return () => {
      const rec = mediaRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      stopExtrasRef.current?.();
    };
  }, []);

  if (!canUploadRecording(props.meeting.status)) return null;

  const progressValue = (() => {
    if (phase === "idle") return 0;
    const base = PHASE_META[phase].value;
    if (phase === "recording") {
      return Math.min(28, 8 + Math.min(elapsedSec, 40) * 0.5);
    }
    if (phase === "uploading") {
      return Math.min(55, base + (pulse % 8) * 1.5);
    }
    if (phase === "transcribing") {
      return Math.min(94, base + (pulse % 12) * 1.8);
    }
    return base;
  })();

  const runTranscription = async () => {
    setPhase("transcribing");
    setPhaseError(null);
    setPulse(0);
    try {
      const res = await requestRecordingTranscription(props.meeting.id);
      const lang = res.language_detected ? ` (${res.language_detected})` : "";
      toast.success(
        res.translated_to_spanish
          ? `Transcripción lista en español${lang}`
          : `Transcripción lista${lang}`,
      );
      setPhase("done");
      props.onDone?.();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "No se pudo transcribir. Puedes subir un .vtt/.txt manualmente.";
      setPhase("error");
      setPhaseError(msg);
      toast.error(msg, { duration: 10000 });
    }
  };

  const saveBlob = async (
    file: File | Blob,
    fileName: string | undefined,
    origin: "manual_upload" | "browser_recorder",
  ) => {
    setPhase("uploading");
    setPhaseError(null);
    setPulse(0);
    try {
      await uploadMeetingRecording({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meeting: props.meeting,
        series: props.series,
        file,
        fileName,
        origin,
      });
      toast.success(
        autoTranscribe
          ? "Grabación guardada — transcribiendo…"
          : "Grabación guardada en la junta",
      );
      props.onDone?.();
      if (autoTranscribe) {
        await runTranscription();
      } else {
        setPhase("done");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar grabación";
      setPhase("error");
      setPhaseError(msg);
      toast.error(msg);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const startRecording = async (mode: CaptureMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Este navegador no permite grabar");
      return;
    }
    try {
      const { stream, stopExtras } = await buildCaptureStream(mode);
      stopExtrasRef.current = stopExtras;

      // Solo audio para Storage + Whisper (≤~24 MB). El video de pantalla
      // hincha el archivo (~167 MB en 2 h) y Storage/Whisper lo rechazan.
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stopExtras();
        stopExtrasRef.current = null;
        throw new Error(
          mode === "av"
            ? "No hay audio de la pestaña/micrófono. Marca «Compartir audio» al elegir la pestaña, o usa Grabar audio."
            : "No se detectó micrófono.",
        );
      }
      const recordStream = new MediaStream(audioTracks);

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      let recorder: MediaRecorder;
      try {
        recorder = mime
          ? new MediaRecorder(recordStream, {
              mimeType: mime,
              // ~64 kbps → ~3 h ≈ 85 MB (bajo tope Storage; Whisper parte en trozos).
              audioBitsPerSecond: 64_000,
            })
          : new MediaRecorder(recordStream, { audioBitsPerSecond: 64_000 });
      } catch {
        recorder = mime
          ? new MediaRecorder(recordStream, { mimeType: mime })
          : new MediaRecorder(recordStream);
      }

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stopExtrasRef.current?.();
        stopExtrasRef.current = null;
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const name =
          mode === "av" ? `grabacion-llamada.${ext}` : `grabacion-junta.${ext}`;
        setPhase("uploading");
        setElapsedSec(0);
        if (blob.size < 1024) {
          setPhase("error");
          setPhaseError("La grabación quedó vacía. Revisa permisos de micrófono/audio de pestaña.");
          toast.error("Grabación vacía");
          mediaRef.current = null;
          return;
        }
        void saveBlob(blob, name, "browser_recorder");
        mediaRef.current = null;
      };

      // Si dejan de compartir la pestaña, detener.
      stream.getVideoTracks().forEach((t) => {
        t.addEventListener("ended", () => {
          if (mediaRef.current && mediaRef.current.state !== "inactive") {
            mediaRef.current.stop();
          }
        });
      });

      mediaRef.current = recorder;
      recorder.start(1000);
      setElapsedSec(0);
      setPhase("recording");
      setPhaseError(null);
      if (mode === "av") {
        toast.message(
          "Grabando audio de la llamada (pestaña + mic). Se guarda solo el audio para poder transcribir.",
        );
      }
    } catch (e) {
      stopExtrasRef.current?.();
      stopExtrasRef.current = null;
      setPhase("idle");
      toast.error(
        e instanceof Error ? e.message : "No se pudo iniciar la grabación",
      );
    }
  };

  const stopRecording = () => {
    const rec = mediaRef.current;
    if (!rec || rec.state === "inactive") return;
    // Feedback inmediato al pulsar Detener (antes de onstop/upload).
    setPhase("uploading");
    rec.stop();
  };

  const size = props.size ?? "sm";
  const disabled = processing || recording;
  const meta = phase !== "idle" ? PHASE_META[phase] : null;

  return (
    <div className="space-y-2 w-full max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*,.webm,.mp3,.m4a,.wav,.ogg,.mp4,.mov"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void saveBlob(f, f.name, "manual_upload");
          }}
        />
        {props.meeting.recording_path && phase === "idle" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Grabación guardada
          </span>
        )}
        {props.meeting.transcript_status === "received" && phase === "idle" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" />
            Transcripción lista
          </span>
        )}
        {recording ? (
          <Button
            type="button"
            size={size}
            variant="destructive"
            onClick={stopRecording}
          >
            <Square className="h-3.5 w-3.5 mr-1" />
            Detener {formatElapsed(elapsedSec)}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size={size}
              variant="outline"
              disabled={disabled}
              onClick={() => void startRecording("audio")}
              title="Solo micrófono — apto para juntas de hasta ~3 horas"
            >
              {phase === "uploading" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Mic className="h-3.5 w-3.5 mr-1" />
              )}
              Grabar audio
            </Button>
            <Button
              type="button"
              size={size}
              variant="outline"
              disabled={disabled}
              onClick={() => void startRecording("av")}
              title="Audio de la pestaña/llamada + micrófono (sin video). Hasta ~3 horas."
            >
              <Monitor className="h-3.5 w-3.5 mr-1" />
              Audio de llamada
            </Button>
          </>
        )}
        <Button
          type="button"
          size={size}
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {phase === "uploading" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1" />
          )}
          Subir grabación
        </Button>
        {props.meeting.recording_path && !recording && (
            <Button
              type="button"
              size={size}
              variant={
                props.meeting.transcript_status === "failed" ||
                props.meeting.transcript_status === "unavailable"
                  ? "default"
                  : "secondary"
              }
              disabled={processing}
              onClick={() => void runTranscription()}
              title={
                props.meeting.transcript_unavailable_reason ||
                "Transcribir con OpenAI (multiidioma → español)"
              }
            >
              {phase === "transcribing" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1" />
              )}
              {props.meeting.transcript_status === "failed" ||
              props.meeting.transcript_status === "unavailable"
                ? "Reintentar transcripción"
                : props.meeting.transcript_status === "received"
                  ? "Volver a transcribir"
                  : "Transcribir IA"}
            </Button>
          )}
        {!props.meeting.recording_path &&
          (props.meeting.transcript_status === "failed" ||
            props.meeting.status === "ended" ||
            props.meeting.status === "minutes_draft") &&
          !recording &&
          phase === "idle" && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              Sin grabación en Storage — sube audio o graba de nuevo para reintentar la
              transcripción.
            </span>
          )}
      </div>

      {showPanel && meta && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5 space-y-2",
            phase === "error"
              ? "border-destructive/40 bg-destructive/5"
              : phase === "done"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-sky-500/30 bg-sky-500/5",
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {phase === "error" ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              ) : phase === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-700 dark:text-sky-400" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">
                  {meta.label}
                  {recording ? ` · ${formatElapsed(elapsedSec)}` : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {phaseError ?? meta.detail}
                </p>
              </div>
            </div>
            {(phase === "done" || phase === "error") && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setPhase("idle");
                  setPhaseError(null);
                }}
              >
                Ocultar
              </Button>
            )}
          </div>
          <Progress
            value={progressValue}
            className={cn(
              "h-2",
              phase === "error" && "[&>div]:bg-destructive",
              phase === "done" && "[&>div]:bg-emerald-500",
            )}
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className={cn(phase === "recording" && "text-foreground font-medium")}>
              1. Grabar
            </span>
            <span
              className={cn(
                (phase === "uploading" ||
                  phase === "transcribing" ||
                  phase === "done") &&
                  "text-foreground font-medium",
              )}
            >
              2. Subir
            </span>
            <span
              className={cn(
                (phase === "transcribing" || phase === "done") &&
                  "text-foreground font-medium",
              )}
            >
              3. Transcribir
            </span>
            <span className={cn(phase === "done" && "text-emerald-700 dark:text-emerald-400 font-medium")}>
              4. Listo
            </span>
          </div>
          {(phase === "uploading" || phase === "transcribing" || phase === "done") &&
            props.meeting.status === "in_progress" && (
              <p className="text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                Detener el audio no cierra la sesión: el badge «En curso» cambia solo al pulsar{" "}
                <strong className="text-foreground font-medium">Terminar junta</strong>.
              </p>
            )}
        </div>
      )}
    </div>
  );
}
