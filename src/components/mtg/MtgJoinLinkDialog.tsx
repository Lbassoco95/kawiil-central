/**
 * Pegar el link de una llamada ya en curso (Teams / Meet / Zoom)
 * para poder entrar desde la junta.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { MtgMeetingRow } from "@/lib/mtg/db";
import { parseMeetingJoinLink } from "@/lib/mtg/joinLink";
import { setMeetingJoinLink } from "@/lib/mtg/setMeetingJoinLink";

export function MtgJoinLinkDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  onDone?: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.open) {
      setValue(props.meeting.teams_join_url ?? "");
    }
  }, [props.open, props.meeting.teams_join_url]);

  const preview = (() => {
    try {
      if (!value.trim()) return null;
      return parseMeetingJoinLink(value);
    } catch {
      return null;
    }
  })();

  const save = async (andOpen: boolean, rawOverride?: string) => {
    const raw = rawOverride !== undefined ? rawOverride : value;
    setBusy(true);
    try {
      const updated = await setMeetingJoinLink({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meeting: props.meeting,
        rawLink: raw,
      });
      toast.success(
        updated.teams_join_url
          ? `Link de ${preview?.label ?? "videollamada"} guardado`
          : "Link de llamada quitado",
      );
      props.onOpenChange(false);
      props.onDone?.();
      if (andOpen && updated.teams_join_url) {
        window.open(updated.teams_join_url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link de la llamada</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Esta junta ya existe: pega el enlace de Teams (u otra) para unirte y para
          que Kawiilito sepa a qué llamada entrar a grabar. La grabación queda en
          Teams; después la extraemos aquí.
        </p>
        <div className="space-y-2">
          <Label htmlFor="mtg-join-link">Enlace</Label>
          <Input
            id="mtg-join-link"
            placeholder="https://teams.microsoft.com/l/meetup-join/…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          {preview && (
            <p className="text-xs text-muted-foreground">
              Detectado: <span className="font-medium text-foreground">{preview.label}</span>
              {preview.teamsOnlineMeetingId && " · id Teams capturado para transcripción"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {props.meeting.teams_join_url && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValue("");
                void save(false, "");
              }}
            >
              Quitar link
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="secondary" disabled={busy || !value.trim()} onClick={() => void save(false)}>
            Guardar
          </Button>
          <Button type="button" disabled={busy || !value.trim()} onClick={() => void save(true)}>
            Guardar y unirse
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
