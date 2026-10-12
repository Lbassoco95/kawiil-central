/**
 * Guardar grabación de la junta: audio, pantalla+audio, o subir archivo.
 * La captura vive en `recordingSession` (global): se puede navegar a otra
 * pantalla sin cortarla; la barra flotante (MtgRecordingDock) la sigue.
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
import { canUploadRecording } from "@/lib/mtg/uploadRecording";
import {
  clearPendingRecording,
  downloadBlobLocally,
  getPendingRecording,
  type PendingRecording,
} from "@/lib/mtg/pendingRecordingStore";
import {
  refreshRecordingContext,
  retranscribe,
  saveRecording,
  startRecording,
  stopRecording,
  useRecordingSession,
  type ReviewPhase,
} from "@/lib/mtg/recordingSession";
import { formatRecordingSizeMb } from "@/lib/mtg/recordingLimits";

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
  const session = useRecordingSession();
  const [recoveredLocal, setRecoveredLocal] = useState<PendingRecording | null>(null);
  const [hidden, setHidden] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const autoTranscribe = props.autoTranscribe !== false;

  // La sesión global puede ser de otra junta (p. ej. grabando una y mirando otra).
  const mine = session.meetingId === props.meeting.id;
  const otherBusy = !mine && session.phase !== "idle" && session.phase !== "done" && session.phase !== "error";
  const phase: ReviewPhase = mine && !hidden ? session.phase : "idle";
  const phaseError = mine ? session.error : null;
  const pendingLocal = mine && session.phase !== "idle" ? session.pendingLocal : recoveredLocal;

  const recording = phase === "recording";
  const processing = phase === "uploading" || phase === "transcribing";
  const showPanel = phase !== "idle";
  const elapsedSec =
    recording && session.startedAt ? Math.max(0, Math.floor((nowTick - session.startedAt) / 1000)) : 0;
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (session.phase === "recording" || session.phase === "uploading") setHidden(false);
  }, [session.phase]);

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  // Barra “viva” mientras sube/transcribe (sin % real del servidor).
  useEffect(() => {
    if (!processing) return;
    const t = window.setInterval(() => setPulse((p) => p + 1), 800);
    return () => window.clearInterval(t);
  }, [processing]);

  // Mantener la sesión global al día con la junta recargada (recording_path, etc.).
  useEffect(() => {
    refreshRecordingContext({ meeting: props.meeting, series: props.series });
  }, [props.meeting, props.series]);

  // Recuperar copia local pendiente (p. ej. falló la subida o se recargó).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await getPendingRecording(props.meeting.id);
        if (cancelled) return;
        if (pending && !props.meeting.recording_path) {
          setRecoveredLocal(pending);
        } else if (pending && props.meeting.recording_path && !pending.partial) {
          await clearPendingRecording(props.meeting.id);
          if (!cancelled) setRecoveredLocal(null);
        }
      } catch {
        /* IndexedDB opcional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.meeting.id, props.meeting.recording_path]);

  if (!canUploadRecording(props.meeting.status)) return null;

  const sessionCtx = () => ({
    organizationId: props.organizationId,
    actorUserId: props.actorUserId,
    meeting: props.meeting,
    series: props.series,
    autoTranscribe,
    onDone: props.onDone,
  });

  const progressValue = (() => {
    if (phase === "idle") return 0;
    const base = PHASE_META[phase].value;
    if (phase === "recording") return Math.min(28, 8 + Math.min(elapsedSec, 40) * 0.5);
    if (phase === "uploading") return Math.min(55, base + (pulse % 8) * 1.5);
    if (phase === "transcribing") return Math.min(94, base + (pulse % 12) * 1.8);
    return base;
  })();

  const retryPendingUpload = async () => {
    const pending = pendingLocal ?? (await getPendingRecording(props.meeting.id));
    if (!pending) {
      toast.error("No hay copia local pendiente");
      return;
    }
    await saveRecording(sessionCtx(), pending.blob, pending.fileName, pending.origin);
  };

  const size = props.size ?? "sm";
  const disabled = processing || recording || otherBusy;
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
            if (f) {
              void saveRecording(sessionCtx(), f, f.name, "manual_upload").finally(() => {
                if (inputRef.current) inputRef.current.value = "";
              });
            }
          }}
        />
        {otherBusy && (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            Ya hay una grabación activa en «{session.meetingTitle}». Termínala para grabar aquí.
          </span>
        )}
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
              onClick={() => void startRecording(sessionCtx(), "audio")}
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
              onClick={() => void startRecording(sessionCtx(), "av")}
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
              onClick={() => void retranscribe(sessionCtx())}
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
                  setHidden(true);
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
