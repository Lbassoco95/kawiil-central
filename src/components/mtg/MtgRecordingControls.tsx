/**
 * Guardar grabación de la junta: subir archivo o grabar audio en el navegador.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Square, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import {
  canUploadRecording,
  uploadMeetingRecording,
} from "@/lib/mtg/uploadRecording";

export function MtgRecordingControls(props: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  onDone?: () => void;
  size?: "sm" | "default";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

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
      mediaRef.current?.stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  if (!canUploadRecording(props.meeting.status)) return null;

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
      toast.success("Grabación guardada en la junta");
      props.onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar grabación");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Este navegador no permite grabar audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        void saveBlob(blob, `grabacion-junta.${ext}`, "browser_recorder");
        mediaRef.current = null;
        setRecording(false);
        setElapsedSec(0);
      };
      mediaRef.current = recorder;
      recorder.start(1000);
      setElapsedSec(0);
      setRecording(true);
    } catch {
      toast.error("No se pudo acceder al micrófono");
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
      {recording ? (
        <Button
          type="button"
          size={size}
          variant="destructive"
          disabled={busy}
          onClick={stopRecording}
        >
          <Square className="h-3.5 w-3.5 mr-1" />
          Detener {mm}:{ss}
        </Button>
      ) : (
        <Button
          type="button"
          size={size}
          variant="outline"
          disabled={busy}
          onClick={() => void startRecording()}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Mic className="h-3.5 w-3.5 mr-1" />
          )}
          Grabar audio
        </Button>
      )}
      <Button
        type="button"
        size={size}
        variant="outline"
        disabled={busy || recording}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5 mr-1" />
        )}
        Subir grabación
      </Button>
    </div>
  );
}
