/**
 * Barra flotante global de la grabación de junta.
 * Permite minimizar la junta y seguir trabajando en Kawiil OS: muestra el
 * cronómetro, Detener y un acceso directo de regreso al tablero.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dismissRecordingSession,
  stopRecording,
  useRecordingSession,
} from "@/lib/mtg/recordingSession";

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function MtgRecordingDock() {
  const session = useRecordingSession();
  const location = useLocation();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  const busy =
    session.phase === "recording" ||
    session.phase === "uploading" ||
    session.phase === "transcribing";

  // Avisar antes de cerrar/recargar la pestaña mientras se graba o sube.
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  useEffect(() => {
    if (session.phase !== "recording") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [session.phase]);

  // Al terminar de subir/transcribir, refrescar el tablero aunque la junta no esté abierta.
  useEffect(() => {
    if ((session.phase === "done" || session.phase === "error") && session.meetingId) {
      void qc.invalidateQueries({ queryKey: ["mtg-board", session.meetingId] });
    }
  }, [session.phase, session.meetingId, qc]);

  if (session.phase === "idle" || !session.meetingId) return null;

  const href = `/juntas/${session.meetingId}`;
  const onMeetingPage = location.pathname === href;
  // En la pantalla de la propia junta ya está el panel completo.
  if (onMeetingPage) return null;

  const elapsed = session.startedAt ? Math.floor((now - session.startedAt) / 1000) : 0;

  return (
    <div
      className="fixed bottom-4 left-4 z-[90] flex max-w-[min(92vw,26rem)] items-center gap-3 rounded-xl border bg-card px-3 py-2 shadow-lg"
      role="status"
      aria-live="polite"
    >
      {session.phase === "recording" && (
        <>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          <div className="min-w-0 text-sm">
            <Link to={href} className="block truncate font-medium hover:underline">
              <Mic className="mr-1 inline h-3.5 w-3.5" />
              {session.meetingTitle || "Junta"}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">
              Grabando · {formatElapsed(elapsed)}
            </span>
          </div>
          <Button size="sm" variant="destructive" onClick={stopRecording} className="shrink-0">
            <Square className="mr-1 h-3.5 w-3.5" />
            Detener
          </Button>
        </>
      )}
      {(session.phase === "uploading" || session.phase === "transcribing") && (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-700" />
          <div className="min-w-0 text-sm">
            <Link to={href} className="block truncate font-medium hover:underline">
              {session.meetingTitle || "Junta"}
            </Link>
            <span className="text-xs text-muted-foreground">
              {session.phase === "uploading" ? "Subiendo grabación…" : "Transcribiendo con IA…"}
            </span>
          </div>
        </>
      )}
      {(session.phase === "done" || session.phase === "error") && (
        <>
          {session.phase === "done" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 text-sm">
            <Link to={href} className="block truncate font-medium hover:underline">
              {session.meetingTitle || "Junta"}
            </Link>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {session.phase === "done"
                ? "Transcripción lista."
                : (session.error ?? "No se pudo completar la revisión.")}
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={dismissRecordingSession}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
