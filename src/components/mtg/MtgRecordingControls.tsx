/**
 * Guardar grabación de la junta: audio, pantalla+audio, o subir archivo.
 * Tras guardar, puede pedir transcripción OpenAI (multiidioma → español).
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Mic,
  Monitor,
  Square,
  Upload,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import {
  canUploadRecording,
  uploadMeetingRecording,
} from "@/lib/mtg/uploadRecording";
import { requestRecordingTranscription } from "@/lib/mtg/requestRecordingTranscription";

type CaptureMode = "audio" | "av";

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

  // Mezcla audio de pestaña + micrófono cuando ambos existen.
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
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const autoTranscribe = props.autoTranscribe !== false;

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

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

  const runTranscription = async () => {
    if (!autoTranscribe) return;
    setTranscribing(true);
    try {
      const res = await requestRecordingTranscription(props.meeting.id);
      const lang = res.language_detected ? ` (${res.language_detected})` : "";
      toast.success(
        res.translated_to_spanish
          ? `Transcripción lista en español${lang}`
          : `Transcripción lista${lang}`,
      );
      props.onDone?.();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "No se pudo transcribir. Puedes subir un .vtt/.txt manualmente.",
        { duration: 10000 },
      );
    } finally {
      setTranscribing(false);
    }
  };

  const saveBlob = async (
    file: File | Blob,
    fileName: string | undefined,
    origin: "manual_upload" | "browser_recorder",
  ) => {
    setBusy(true);
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
      if (autoTranscribe) await runTranscription();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar grabación");
    } finally {
      setBusy(false);
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

      const preferVideo = mode === "av" && stream.getVideoTracks().length > 0;
      const mimeCandidates = preferVideo
        ? [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm",
            "audio/webm;codecs=opus",
            "audio/webm",
          ]
        : ["audio/webm;codecs=opus", "audio/webm"];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stopExtrasRef.current?.();
        stopExtrasRef.current = null;
        const type = recorder.mimeType || (preferVideo ? "video/webm" : "audio/webm");
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const name =
          preferVideo ? `grabacion-junta-av.${ext}` : `grabacion-junta.${ext}`;
        void saveBlob(blob, name, "browser_recorder");
        mediaRef.current = null;
        setRecording(false);
        setElapsedSec(0);
      };

      // Si el usuario deja de compartir pantalla, detener.
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
      setRecording(true);
      if (mode === "av") {
        toast.message("Grabando pantalla + audio. Detén al terminar la junta.");
      }
    } catch (e) {
      stopExtrasRef.current?.();
      stopExtrasRef.current = null;
      toast.error(
        e instanceof Error ? e.message : "No se pudo iniciar la grabación",
      );
    }
  };

  const stopRecording = () => {
    const rec = mediaRef.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
  };

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const size = props.size ?? "sm";
  const disabled = busy || transcribing;

  return (
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
      {props.meeting.recording_path && !recording && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Grabación guardada
        </span>
      )}
      {props.meeting.transcript_status === "received" && (
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
          disabled={disabled}
          onClick={stopRecording}
        >
          <Square className="h-3.5 w-3.5 mr-1" />
          Detener {mm}:{ss}
        </Button>
      ) : (
        <>
          <Button
            type="button"
            size={size}
            variant="outline"
            disabled={disabled}
            onClick={() => void startRecording("audio")}
            title="Solo micrófono (mejor para Whisper ≤24 MB)"
          >
            {busy ? (
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
            title="Pestaña/pantalla + micrófono (archivo más pesado)"
          >
            <Monitor className="h-3.5 w-3.5 mr-1" />
            Pantalla + audio
          </Button>
        </>
      )}
      <Button
        type="button"
        size={size}
        variant="outline"
        disabled={disabled || recording}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
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
          variant="secondary"
          disabled={disabled}
          onClick={() => void runTranscription()}
          title="Transcribir con OpenAI (multiidioma → español)"
        >
          {transcribing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          Transcribir IA
        </Button>
      )}
    </div>
  );
}
