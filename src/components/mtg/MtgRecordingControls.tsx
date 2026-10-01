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
  Download,
  RefreshCw,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import {
  canUploadRecording,
  uploadMeetingRecording,
} from "@/lib/mtg/uploadRecording";
import { requestRecordingTranscription } from "@/lib/mtg/requestRecordingTranscription";
import {
  checkpointPendingRecording,
  clearPendingRecording,
  downloadBlobLocally,
  getPendingRecording,
  putPendingRecording,
  type PendingRecording,
} from "@/lib/mtg/pendingRecordingStore";
import { formatRecordingSizeMb } from "@/lib/mtg/recordingLimits";

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
  const captureMimeRef = useRef("audio/webm");
  const captureNameRef = useRef("grabacion-junta.webm");
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [pendingLocal, setPendingLocal] = useState<PendingRecording | null>(null);
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

  // No perder audio si cierran la pestaña mientras graban o suben.
  useEffect(() => {
    if (!(recording || phase === "uploading" || pendingLocal)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [recording, phase, pendingLocal]);

  // Recuperar copia local pendiente (p. ej. falló la subida o se recargó).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await getPendingRecording(props.meeting.id);
        if (cancelled) return;
        if (pending && !props.meeting.recording_path) {
          setPendingLocal(pending);
        } else if (pending && props.meeting.recording_path && !pending.partial) {
          await clearPendingRecording(props.meeting.id);
          if (!cancelled) setPendingLocal(null);
        }
      } catch {
        /* IndexedDB opcional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.meeting.id, props.meeting.recording_path]);

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
    const contentType = file.type || "audio/webm";
    const name = fileName ?? `grabacion-${Date.now()}.webm`;
    try {
      // Respaldo local ANTES de Storage: si falla la red, no se pierde el audio.
      await putPendingRecording({
        meetingId: props.meeting.id,
        fileName: name,
        contentType,
        sizeBytes: file.size,
        origin,
        updatedAt: new Date().toISOString(),
        partial: false,
        blob: file instanceof Blob ? file : new Blob([file], { type: contentType }),
      });
      const pending = await getPendingRecording(props.meeting.id);
      if (pending) setPendingLocal(pending);

      const res = await uploadMeetingRecording({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meeting: props.meeting,
        series: props.series,
        file,
        fileName: name,
        origin,
      });
      await clearPendingRecording(props.meeting.id);
      setPendingLocal(null);
      toast.success(
        autoTranscribe
          ? `Grabación en Storage (${formatRecordingSizeMb(res.sizeBytes)} MB) — transcribiendo…`
          : `Grabación guardada en Storage (${formatRecordingSizeMb(res.sizeBytes)} MB)`,
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
      setPhaseError(
        `${msg} La copia local se conserva: puedes reintentar la subida o descargarla.`,
      );
      toast.error(msg, {
        duration: 12000,
        description: "Copia local disponible — Reintentar o Descargar",
      });
      try {
        const pending = await getPendingRecording(props.meeting.id);
        if (pending) setPendingLocal(pending);
      } catch {
        /* ignore */
      }
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const retryPendingUpload = async () => {
    const pending = pendingLocal ?? (await getPendingRecording(props.meeting.id));
    if (!pending) {
      toast.error("No hay copia local pendiente");
      return;
    }
    await saveBlob(pending.blob, pending.fileName, pending.origin);
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
      const type = recorder.mimeType || mime || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const name =
        mode === "av" ? `grabacion-llamada.${ext}` : `grabacion-junta.${ext}`;
      captureMimeRef.current = type;
      captureNameRef.current = name;
      let chunkCount = 0;
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
        chunkCount += 1;
        // Checkpoint cada ~15 s para no perder todo si se cierra la pestaña.
        if (chunkCount % 15 === 0) {
          void checkpointPendingRecording({
            meetingId: props.meeting.id,
            chunks: chunksRef.current,
            fileName: captureNameRef.current,
            contentType: captureMimeRef.current,
            origin: "browser_recorder",
          }).catch(() => {
            /* best-effort */
          });
        }
      };
      recorder.onstop = () => {
        stopExtrasRef.current?.();
        stopExtrasRef.current = null;
        const blob = new Blob(chunksRef.current, { type: captureMimeRef.current });
        setPhase("uploading");
        setElapsedSec(0);
        if (blob.size < 1024) {
          setPhase("error");
          setPhaseError("La grabación quedó vacía. Revisa permisos de micrófono/audio de pestaña.");
          toast.error("Grabación vacía");
          mediaRef.current = null;
          return;
        }
        void saveBlob(blob, captureNameRef.current, "browser_recorder");
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
            En Storage
            {props.meeting.recording_bytes != null
              ? ` · ${formatRecordingSizeMb(props.meeting.recording_bytes)} MB`
              : ""}
          </span>
        )}
        {pendingLocal && !props.meeting.recording_path && phase === "idle" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
            <HardDrive className="h-3.5 w-3.5" />
            Copia local pendiente · {formatRecordingSizeMb(pendingLocal.sizeBytes)} MB
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
        {pendingLocal && !props.meeting.recording_path && !recording && (
          <>
            <Button
              type="button"
              size={size}
              variant="default"
              disabled={processing}
              onClick={() => void retryPendingUpload()}
              title="Subir de nuevo la copia local a Storage"
            >
              {phase === "uploading" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              Reintentar subida
            </Button>
            <Button
              type="button"
              size={size}
              variant="outline"
              disabled={processing}
              onClick={() => {
                downloadBlobLocally(pendingLocal.blob, pendingLocal.fileName);
                toast.message("Descarga iniciada — conserva el archivo por si acaso");
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Descargar copia local
            </Button>
          </>
        )}
        {!props.meeting.recording_path &&
          !pendingLocal &&
          (props.meeting.transcript_status === "failed" ||
            props.meeting.status === "ended" ||
            props.meeting.status === "minutes_draft") &&
          !recording &&
          phase === "idle" && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              Sin grabación en Storage — sube audio o graba de nuevo para no perder la sesión.
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
