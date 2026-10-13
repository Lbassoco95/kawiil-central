/**
 * Sesión de grabación de junta a nivel de módulo (fuera de React).
 *
 * El MediaRecorder vive aquí, no en el componente: así se puede navegar a otra
 * pantalla de Kawiil OS (minimizar la junta) sin cortar la grabación. Los
 * componentes solo se suscriben con `useRecordingSession`.
 * Cerrar/recargar la pestaña sí detiene la captura (límite del navegador);
 * el checkpoint en IndexedDB deja un respaldo parcial.
 */

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import { uploadMeetingRecording } from "@/lib/mtg/uploadRecording";
import { requestRecordingTranscription } from "@/lib/mtg/requestRecordingTranscription";
import {
  checkpointPendingRecording,
  clearPendingRecording,
  getPendingRecording,
  putPendingRecording,
  type PendingRecording,
} from "@/lib/mtg/pendingRecordingStore";
import { formatRecordingSizeMb } from "@/lib/mtg/recordingLimits";

export type CaptureMode = "audio" | "av";

export type ReviewPhase =
  | "idle"
  | "recording"
  | "uploading"
  | "transcribing"
  | "done"
  | "error";

export type RecordingSessionState = {
  phase: ReviewPhase;
  meetingId: string | null;
  meetingTitle: string;
  startedAt: number | null;
  error: string | null;
  pendingLocal: PendingRecording | null;
};

type SessionContext = {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  autoTranscribe: boolean;
  onDone?: () => void;
};

const IDLE: RecordingSessionState = {
  phase: "idle",
  meetingId: null,
  meetingTitle: "",
  startedAt: null,
  error: null,
  pendingLocal: null,
};

let state: RecordingSessionState = IDLE;
let ctx: SessionContext | null = null;
let recorder: MediaRecorder | null = null;
let stopExtras: (() => void) | null = null;
let chunks: Blob[] = [];
let captureMime = "audio/webm";
let captureName = "grabacion-junta.webm";
const listeners = new Set<() => void>();

function setState(patch: Partial<RecordingSessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getRecordingSession(): RecordingSessionState {
  return state;
}

export function useRecordingSession(): RecordingSessionState {
  return useSyncExternalStore(subscribe, getRecordingSession, getRecordingSession);
}

/** Hay captura de audio activa (no solo subiendo/transcribiendo). */
export function isRecordingActive(): boolean {
  return state.phase === "recording";
}

/** Actualiza la junta/serie cuando el tablero recarga (mismo meeting). */
export function refreshRecordingContext(patch: Partial<SessionContext>) {
  if (ctx && patch.meeting && patch.meeting.id !== ctx.meeting.id) return;
  if (ctx) ctx = { ...ctx, ...patch };
}

async function buildCaptureStream(mode: CaptureMode): Promise<{
  stream: MediaStream;
  stopExtras: () => void;
}> {
  if (mode === "audio") {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { stream, stopExtras: () => stream.getTracks().forEach((t) => t.stop()) };
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

  const stopBase = () => {
    display.getTracks().forEach((t) => t.stop());
    mic?.getTracks().forEach((t) => t.stop());
  };

  const hasDisplayAudio = display.getAudioTracks().length > 0;
  const hasMic = !!mic && mic.getAudioTracks().length > 0;

  if (hasDisplayAudio && hasMic && typeof AudioContext !== "undefined") {
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
    audioCtx.createMediaStreamSource(mic!).connect(dest);
    return {
      stream: new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]),
      stopExtras: () => {
        stopBase();
        void audioCtx.close();
      },
    };
  }

  const outAudio = hasMic ? mic!.getAudioTracks() : display.getAudioTracks();
  return {
    stream: new MediaStream([...display.getVideoTracks(), ...outAudio]),
    stopExtras: stopBase,
  };
}

async function runTranscription(force = false): Promise<void> {
  if (!ctx) return;
  setState({ phase: "transcribing", error: null });
  try {
    const res = await requestRecordingTranscription(ctx.meeting.id, force);
    const lang = res.language_detected ? ` (${res.language_detected})` : "";
    toast.success(
      res.translated_to_spanish
        ? `Transcripción lista en español${lang}`
        : `Transcripción lista${lang}`,
    );
    setState({ phase: "done" });
    ctx.onDone?.();
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "No se pudo transcribir. Puedes subir un .vtt/.txt manualmente.";
    setState({ phase: "error", error: msg });
    toast.error(msg, { duration: 10000 });
  }
}

export async function retranscribe(session: SessionContext, force = false): Promise<void> {
  ctx = session;
  setState({ meetingId: session.meeting.id, meetingTitle: meetingLabel(session) });
  await runTranscription(force);
}

function meetingLabel(c: SessionContext): string {
  return c.series?.title ?? c.meeting.title ?? "Junta";
}

/** Guarda (respaldo local → Storage) y opcionalmente transcribe. */
export async function saveRecording(
  session: SessionContext,
  file: File | Blob,
  fileName: string | undefined,
  origin: "manual_upload" | "browser_recorder",
): Promise<void> {
  ctx = session;
  setState({
    phase: "uploading",
    meetingId: session.meeting.id,
    meetingTitle: meetingLabel(session),
    error: null,
  });
  const contentType = file.type || "audio/webm";
  const name = fileName ?? `grabacion-${Date.now()}.webm`;
  try {
    await putPendingRecording({
      meetingId: session.meeting.id,
      fileName: name,
      contentType,
      sizeBytes: file.size,
      origin,
      updatedAt: new Date().toISOString(),
      partial: false,
      blob: file instanceof Blob ? file : new Blob([file], { type: contentType }),
    });
    setState({ pendingLocal: await getPendingRecording(session.meeting.id) });

    const res = await uploadMeetingRecording({
      organizationId: session.organizationId,
      actorUserId: session.actorUserId,
      meeting: session.meeting,
      series: session.series,
      file,
      fileName: name,
      origin,
    });
    await clearPendingRecording(session.meeting.id);
    setState({ pendingLocal: null });
    toast.success(
      session.autoTranscribe
        ? `Grabación en Storage (${formatRecordingSizeMb(res.sizeBytes)} MB) — transcribiendo…`
        : `Grabación guardada en Storage (${formatRecordingSizeMb(res.sizeBytes)} MB)`,
    );
    session.onDone?.();
    if (session.autoTranscribe) await runTranscription();
    else setState({ phase: "done" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al guardar grabación";
    setState({
      phase: "error",
      error: `${msg} La copia local se conserva: puedes reintentar la subida o descargarla.`,
    });
    toast.error(msg, {
      duration: 12000,
      description: "Copia local disponible — Reintentar o Descargar",
    });
    try {
      setState({ pendingLocal: await getPendingRecording(session.meeting.id) });
    } catch {
      /* ignore */
    }
  }
}

export async function startRecording(session: SessionContext, mode: CaptureMode): Promise<void> {
  if (state.phase === "recording") {
    toast.error("Ya hay una grabación en curso");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast.error("Este navegador no permite grabar");
    return;
  }
  try {
    const built = await buildCaptureStream(mode);
    stopExtras = built.stopExtras;

    // Solo audio: el video de pantalla hincha el archivo y Storage/Whisper lo rechazan.
    const audioTracks = built.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stopExtras();
      stopExtras = null;
      throw new Error(
        mode === "av"
          ? "No hay audio de la pestaña/micrófono. Marca «Compartir audio» al elegir la pestaña, o usa Grabar audio."
          : "No se detectó micrófono.",
      );
    }
    const recordStream = new MediaStream(audioTracks);

    const mime =
      ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      ) || "";
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(recordStream, {
        ...(mime ? { mimeType: mime } : {}),
        // ~64 kbps → ~3 h ≈ 85 MB (bajo tope Storage; Whisper parte en trozos).
        audioBitsPerSecond: 64_000,
      });
    } catch {
      rec = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
    }

    ctx = session;
    chunks = [];
    const type = rec.mimeType || mime || "audio/webm";
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    captureMime = type;
    captureName = mode === "av" ? `grabacion-llamada.${ext}` : `grabacion-junta.${ext}`;
    const meetingId = session.meeting.id;

    let chunkCount = 0;
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
      chunkCount += 1;
      // Checkpoint cada ~15 s para no perder todo si se cierra la pestaña.
      if (chunkCount % 15 === 0) {
        void checkpointPendingRecording({
          meetingId,
          chunks,
          fileName: captureName,
          contentType: captureMime,
          origin: "browser_recorder",
        }).catch(() => {
          /* best-effort */
        });
      }
    };
    rec.onstop = () => {
      stopExtras?.();
      stopExtras = null;
      recorder = null;
      const blob = new Blob(chunks, { type: captureMime });
      if (blob.size < 1024) {
        setState({
          phase: "error",
          startedAt: null,
          error: "La grabación quedó vacía. Revisa permisos de micrófono/audio de pestaña.",
        });
        toast.error("Grabación vacía");
        return;
      }
      setState({ startedAt: null });
      void saveRecording(ctx ?? session, blob, captureName, "browser_recorder");
    };

    // Si dejan de compartir la pestaña, detener.
    built.stream.getVideoTracks().forEach((t) => {
      t.addEventListener("ended", () => stopRecording());
    });

    recorder = rec;
    rec.start(1000);
    setState({
      phase: "recording",
      meetingId,
      meetingTitle: meetingLabel(session),
      startedAt: Date.now(),
      error: null,
    });
    toast.message(
      mode === "av"
        ? "Grabando audio de la llamada (pestaña + mic). Puedes seguir usando Kawiil OS: la grabación continúa."
        : "Grabando. Puedes seguir usando Kawiil OS: la grabación continúa.",
    );
  } catch (e) {
    stopExtras?.();
    stopExtras = null;
    setState({ phase: "idle" });
    toast.error(e instanceof Error ? e.message : "No se pudo iniciar la grabación");
  }
}

export function stopRecording(): void {
  const rec = recorder;
  if (!rec || rec.state === "inactive") return;
  setState({ phase: "uploading" });
  rec.stop();
}

export function dismissRecordingSession(): void {
  if (state.phase === "recording" || state.phase === "uploading" || state.phase === "transcribing") {
    return;
  }
  setState({ phase: "idle", error: null });
}

export function setPendingLocal(p: PendingRecording | null): void {
  setState({ pendingLocal: p });
}
