/**
 * Barra de captura remota: unirse a Teams / pegar link / Kawiilito.
 *
 * El cerebro de Hetzner (openclaw) NO entra a la reunión: sirve para la minuta
 * cuando ya hay audio/transcripción. Hoy: grabar en Teams o Audio de llamada;
 * bot que se une = roadmap.
 */

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ExternalLink, Link2, Bot, Loader2, Video, DownloadCloud, LogOut } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { MtgMeetingRow } from "@/lib/mtg/db";
import { assessKawiilitoCapabilities } from "@/lib/mtg/kawiilitoCapabilities";

export function MtgCallCaptureBar(props: {
  meeting: MtgMeetingRow;
  onPasteLink: () => void;
  onBotSent?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [media, setMedia] = useState<{ video_url: string | null; audio_url: string | null } | null>(
    null,
  );
  const joinUrl = props.meeting.teams_join_url;
  const cap = assessKawiilitoCapabilities({
    status: props.meeting.status,
    teamsJoinUrl: props.meeting.teams_join_url,
    teamsOnlineMeetingId: props.meeting.teams_online_meeting_id,
  });

  const onViewRecording = async () => {
    setMediaBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mtg-recall-media", {
        body: { meeting_id: props.meeting.id },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? await ctx.json().catch(() => null) : null;
        const extra = [detail?.status, detail?.details].filter(Boolean).join(" · ");
        throw new Error(
          extra ? `${detail?.error ?? error.message} (${String(extra).slice(0, 300)})` : (detail?.error ?? error.message),
        );
      }
      if (data?.error) throw new Error(data.error);
      setMedia({ video_url: data.video_url ?? null, audio_url: data.audio_url ?? null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir la grabación", {
        duration: 10000,
      });
    } finally {
      setMediaBusy(false);
    }
  };

  // Se ofrece sacarlo mientras no conste que ya salió (también con estados viejos o vacíos).
  const botInCall =
    !!props.meeting.recall_bot_id &&
    !["call_ended", "done", "fatal", "leaving"].includes(props.meeting.recall_bot_status ?? "");

  const onLeaveBot = async () => {
    if (
      !window.confirm(
        "¿Sacar a Kawiilito de la llamada? Dejará de grabar y empezará a armar la transcripción y la minuta. No se puede deshacer.",
      )
    ) {
      return;
    }
    setLeaveBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mtg-recall-sync", {
        body: { meeting_id: props.meeting.id, leave: true },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? await ctx.json().catch(() => null) : null;
        throw new Error(detail?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      if (data?.transcript_saved) {
        toast.success("Kawiilito salió, la junta se cerró y ya se trajo la transcripción con hablantes");
      } else {
        toast.success(
          "Kawiilito salió y la junta se cerró. La transcripción tarda unos minutos: pulsa Traer grabación para bajarla.",
        );
      }
      props.onBotSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo sacar a Kawiilito");
    } finally {
      setLeaveBusy(false);
    }
  };

  const onSyncRecall = async () => {
    setSyncBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mtg-recall-sync", {
        body: { meeting_id: props.meeting.id },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? await ctx.json().catch(() => null) : null;
        throw new Error(detail?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      if (data.transcript_saved) {
        toast.success("Listo: se trajo la transcripción con hablantes y se está armando la minuta");
      } else if (!data.bot_left) {
        toast.message(
          `Kawiilito sigue en la llamada${data.bot_status ? ` (${data.bot_status})` : ""}. Si la junta ya terminó, usa Sacar a Kawiilito; si no, vuelve a pulsar Traer grabación al terminar.`,
        );
      } else if (!data.has_transcript) {
        toast.message("La llamada terminó, pero Recall todavía no tiene la transcripción. Intenta en unos minutos.");
      } else {
        toast.message("La transcripción ya estaba guardada.");
      }
      props.onBotSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo traer la grabación");
    } finally {
      setSyncBusy(false);
    }
  };

  const onInviteKawiilito = async () => {
    if (!cap.meetingReady) {
      toast.message(cap.lines.join(" "), { duration: 10000 });
      return;
    }
    if (!cap.hasJoinUrl) {
      toast.message(cap.lines.join(" "), { duration: 10000 });
      props.onPasteLink();
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mtg-recall-join", {
        body: { meeting_id: props.meeting.id },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? await ctx.json().catch(() => null) : null;
        const extra = [detail?.status, detail?.details].filter(Boolean).join(" · ");
        throw new Error(
          extra ? `${detail?.error ?? error.message} (${String(extra).slice(0, 300)})` : (detail?.error ?? error.message),
        );
      }
      if (data?.error) throw new Error(data.error);
      toast.success("Kawiilito va en camino: admítelo en la sala de espera de Teams");
      props.onBotSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar el bot");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">
          Teams · captura
        </span>
        {joinUrl ? (
          <Button asChild size="sm" variant="default">
            <a href={joinUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Unirse a Teams
            </a>
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={props.onPasteLink}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Pegar link de la reunión
          </Button>
        )}
        {joinUrl && (
          <Button type="button" size="sm" variant="ghost" onClick={props.onPasteLink}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Cambiar link
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onInviteKawiilito}
          disabled={busy}
          title="Envía el bot de Recall a la llamada: graba y transcribe con quién habla"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Bot className="h-3.5 w-3.5 mr-1" />
          )}
          {props.meeting.recall_bot_id ? "Reenviar Kawiilito" : "Invitar Kawiilito"}
          {props.meeting.recall_bot_status && (
            <span className="ml-2 rounded bg-background/60 px-1.5 text-[10px]">
              {props.meeting.recall_bot_status}
            </span>
          )}
        </Button>
        {props.meeting.recall_bot_id && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSyncRecall}
            disabled={syncBusy}
            title="Actualiza el estado del bot y trae de Recall la transcripción con hablantes"
          >
            {syncBusy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5 mr-1" />
            )}
            Traer grabación
          </Button>
        )}
        {props.meeting.recall_bot_id && botInCall && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onLeaveBot}
            disabled={leaveBusy}
            title="Saca a Kawiilito de la llamada, cierra la junta y trae la transcripción si ya está lista"
          >
            {leaveBusy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5 mr-1" />
            )}
            Sacar a Kawiilito
          </Button>
        )}
        {props.meeting.recall_bot_id && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onViewRecording}
            disabled={mediaBusy}
          >
            {mediaBusy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Video className="h-3.5 w-3.5 mr-1" />
            )}
            Ver grabación
          </Button>
        )}
      </div>
      <Dialog open={!!media} onOpenChange={(o) => !o && setMedia(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Grabación de la llamada</DialogTitle>
          </DialogHeader>
          {media?.video_url ? (
            <video src={media.video_url} controls className="w-full rounded-md bg-black" />
          ) : media?.audio_url ? (
            <audio src={media.audio_url} controls className="w-full" />
          ) : null}
          <a
            className="text-xs underline text-muted-foreground"
            href={media?.video_url ?? media?.audio_url ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            Descargar / abrir en otra pestaña (el enlace es temporal)
          </a>
        </DialogContent>
      </Dialog>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {joinUrl
          ? "Link listo: Invitar Kawiilito envía el bot de Recall (transcripción con hablantes). También puedes grabar en Teams o con Audio de llamada."
          : "Sin link: pégalo. Kawiilito-join y extracción Graph automática aún no están conectados; sí lo están grabación en browser + Whisper + openclaw para minuta."}
      </p>
    </div>
  );
}
