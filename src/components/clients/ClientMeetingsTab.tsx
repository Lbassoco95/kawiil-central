/**
 * Pestaña "Juntas" de la ficha del cliente (Múuch', Bloque 1).
 *
 * Sección "Series": las del cliente más las de los grupos a los que pertenece
 * (estas en solo lectura, con etiqueta "junta del grupo").
 * Sección "Historial de juntas": cada junta con su estatus, acuerdos
 * confirmados/total y marca de minuta aprobada.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, Plus, Repeat, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateMX } from "@/lib/dateUtils";
import type { Tables } from "@/integrations/supabase/types";
import { useProfiles } from "@/hooks/useTasks";
import { useMtgSeriesForClient, type MtgSeries } from "@/hooks/useMtgSeries";
import { useMtgMeetingsForClient } from "@/hooks/useMtgMeetings";
import { CADENCE, MEETING_STATUS } from "@/lib/mtg/constants";
import { MtgSeriesDialog } from "@/components/clients/MtgSeriesDialog";
import { MtgAdhocMeetingDialog } from "@/components/clients/MtgAdhocMeetingDialog";

type Client = Tables<"clients">;

export function ClientMeetingsTab({ client }: { client: Client }) {
  const { data: series = [], isLoading: loadingSeries } = useMtgSeriesForClient(client.id);
  const { data: meetings = [], isLoading: loadingMeetings } = useMtgMeetingsForClient(client.id);
  const { data: profiles = [] } = useProfiles();

  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false);
  const [editingSeries, setEditingSeries] = useState<MtgSeries | null>(null);
  const [adhocDialogOpen, setAdhocDialogOpen] = useState(false);

  const profileName = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.user_id, p.full_name ?? p.email ?? "—"]));
    return (userId: string | null) => (userId ? m.get(userId) ?? "—" : "—");
  }, [profiles]);

  // Próxima junta 'planned' por serie.
  const nextMeetingBySeries = useMemo(() => {
    const now = new Date();
    const m = new Map<string, string>();
    for (const mtg of meetings) {
      if (!mtg.series_id || mtg.status !== "planned") continue;
      const at = new Date(mtg.scheduled_at);
      if (at < now) continue;
      const prev = m.get(mtg.series_id);
      if (!prev || mtg.scheduled_at < prev) m.set(mtg.series_id, mtg.scheduled_at);
    }
    return m;
  }, [meetings]);

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Button
          size="sm"
          onClick={() => {
            setEditingSeries(null);
            setSeriesDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nueva serie
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAdhocDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva junta
        </Button>
      </div>

      {/* Series */}
      <h3 className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">
        Series
      </h3>
      {loadingSeries ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
      ) : series.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Repeat className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">Sin series de juntas.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="glass-card divide-y divide-border/30 overflow-hidden mb-6">
          {series.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center justify-between gap-3 py-3 px-4",
                !s.isGroupSeries && "cursor-pointer hover:bg-secondary/30"
              )}
              onClick={() => {
                if (s.isGroupSeries) return;
                setEditingSeries(s);
                setSeriesDialogOpen(true);
              }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {s.title}
                  </span>
                  {s.isGroupSeries && (
                    <Badge variant="outline" className="text-[10px]">
                      <Users className="h-3 w-3 mr-1" />
                      Junta del grupo{s.groupName ? `: ${s.groupName}` : ""}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {CADENCE[s.cadence].label} · {s.default_duration_min} min · La lleva{" "}
                  {profileName(s.owner_user_id)}
                  {nextMeetingBySeries.get(s.id) && (
                    <>
                      {" "}
                      · Próxima: {formatDateMX(nextMeetingBySeries.get(s.id)!.slice(0, 10))}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {s.send_minutes_to_client && (
                  <Badge variant="outline" className="text-[10px]">
                    Envía minuta
                  </Badge>
                )}
                {s.auto_transcript && (
                  <Badge variant="outline" className="text-[10px]">
                    Transcribe
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Historial de juntas */}
      <h3 className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">
        Historial de juntas
      </h3>
      {loadingMeetings ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
      ) : meetings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">Sin juntas registradas.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="glass-card divide-y divide-border/30 overflow-hidden">
          {meetings.map((m) => {
            const status = MEETING_STATUS[m.status];
            return (
              <div key={m.id} className="flex items-center justify-between gap-3 py-3 px-4">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-foreground">
                    {formatDateMX(m.scheduled_at.slice(0, 10))}
                  </span>
                  <span className="text-[11px] text-muted-foreground ml-2">
                    {new Date(m.scheduled_at).toLocaleTimeString("es-MX", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {m.duration_min ? ` · ${m.duration_min} min` : ""}
                    {!m.series_id ? " · Ad hoc" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {m.agreementsTotal > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      Acuerdos {m.agreementsConfirmed}/{m.agreementsTotal}
                    </span>
                  )}
                  {m.approvedMinutesId && (
                    <span className="text-[11px] text-green-700 dark:text-green-400">
                      Minuta aprobada
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] border-0 px-1.5 py-0", status.color)}
                  >
                    {status.label}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <MtgSeriesDialog
        open={seriesDialogOpen}
        onOpenChange={setSeriesDialogOpen}
        client={client}
        series={editingSeries}
      />
      <MtgAdhocMeetingDialog
        open={adhocDialogOpen}
        onOpenChange={setAdhocDialogOpen}
        client={client}
      />
    </>
  );
}
