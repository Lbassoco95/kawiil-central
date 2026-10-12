/**
 * Agregar gente del equipo a la junta para que reciba el resumen (minuta).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useProfiles } from "@/hooks/useTasks";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import { meetingTeamIds, notifyMeetingTeam, saveMeetingTeam } from "@/lib/mtg/meetingTeam";

export function MtgTeamDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  onDone?: () => void;
}) {
  const { data: profiles = [] } = useProfiles();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const owner = props.series?.owner_user_id ?? null;
  // Del equipo fijo de la serie: se muestran marcados y no se quitan desde aquí.
  const seriesIds = useMemo(
    () => new Set(meetingTeamIds(props.series)),
    [props.series],
  );

  useEffect(() => {
    if (props.open) setSelected(meetingTeamIds(props.series, props.meeting));
  }, [props.open, props.series, props.meeting]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return profiles.filter(
      (p) =>
        !needle ||
        (p.full_name ?? "").toLowerCase().includes(needle) ||
        (p.email ?? "").toLowerCase().includes(needle),
    );
  }, [profiles, q]);

  const toggle = (id: string) => {
    if (seriesIds.has(id)) return;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const before = new Set(meetingTeamIds(props.series, props.meeting));
      const own = selected.filter((id) => !seriesIds.has(id));
      await saveMeetingTeam({ meetingId: props.meeting.id, userIds: own });
      const added = own.filter((id) => !before.has(id));
      if (added.length > 0) {
        await notifyMeetingTeam({
          actorUserId: props.actorUserId,
          meeting: props.meeting,
          series: props.series,
          title: props.meeting.title,
          kind: "added",
          onlyUserIds: added,
        });
      }
      toast.success("Equipo de la junta actualizado — recibirán el resumen al aprobarse la minuta");
      props.onOpenChange(false);
      props.onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el equipo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Equipo de la junta</DialogTitle>
        </DialogHeader>
        {(
          <>
            <p className="text-sm text-muted-foreground">
              Las personas seleccionadas reciben notificación y correo con el resumen cuando se
              aprueba la minuta. Aplica a esta junta, tenga o no serie.
            </p>
            <Input placeholder="Buscar persona…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {filtered.map((p) => {
                const active = selected.includes(p.user_id);
                const isOwner = p.user_id === owner;
                const fromSeries = seriesIds.has(p.user_id);
                return (
                  <button
                    key={p.user_id}
                    type="button"
                    disabled={fromSeries}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50",
                      active && "bg-primary/10",
                    )}
                    onClick={() => toggle(p.user_id)}
                  >
                    <Checkbox
                      checked={active}
                      onCheckedChange={() => toggle(p.user_id)}
                      className="pointer-events-none"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.full_name || p.email}</span>
                      {p.full_name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.email}
                        </span>
                      )}
                    </span>
                    {fromSeries && (
                      <span className="text-[10px] text-muted-foreground">
                        {isOwner ? "Responsable" : "De la serie"}
                      </span>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="p-3 text-center text-xs text-muted-foreground">Sin resultados</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? "Guardando…" : "Guardar equipo"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
