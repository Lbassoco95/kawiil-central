import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Radio, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JORNADA_STATE_LABEL,
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  formatDuration,
  summarizeJornada,
  type RhJornadaState,
} from "@/lib/rh";
import { useOrgAttendance, useOrgEventsToday, useOfficeLocations } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";

const STATE_STYLE: Record<RhJornadaState, string> = {
  working: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  lunch: "border-amber-300 text-amber-700 dark:text-amber-400",
  break: "border-sky-300 text-sky-700 dark:text-sky-400",
  done: "border-border text-muted-foreground",
  none: "border-border text-muted-foreground",
};

export function TeamLivePresence() {
  const { data: sessions = [], isLoading } = useOrgAttendance();
  const { data: events = [] } = useOrgEventsToday();
  const { data: users = [] } = useOrgUsers();
  const { data: offices = [] } = useOfficeLocations();

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.full_name);
    return m;
  }, [users]);

  const officeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of offices) m.set(o.id, o.name);
    return m;
  }, [offices]);

  // Sesiones abiertas (sin salida) = quienes están conectados ahora.
  const live = useMemo(() => {
    const open = sessions.filter((s) => !s.check_out_at);
    return open
      .map((s) => {
        const evs = events.filter((e) => e.attendance_id === s.id);
        const summary = summarizeJornada(evs);
        return { session: s, summary };
      })
      .filter((x) => x.summary.state !== "none" && x.summary.state !== "done")
      .sort((a, b) => new Date(a.session.check_in_at).getTime() - new Date(b.session.check_in_at).getTime());
  }, [sessions, events]);

  function locationText(s: (typeof live)[number]["session"]): string {
    if (s.work_mode === "office") {
      const name = s.office_location_id ? officeById.get(s.office_location_id) : null;
      if (name) return s.within_geofence === false ? `${name} (fuera de geocerca)` : name;
      return s.within_geofence === false ? "Oficina (fuera de geocerca)" : "Oficina";
    }
    if (s.work_mode === "home_office") return "Home office";
    return "En campo / comisión";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-emerald-500" />
          Conectados ahora
          <Badge variant="secondary" className="ml-1">{live.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : live.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nadie tiene una jornada activa en este momento.
          </p>
        ) : (
          <ul className="divide-y">
            {live.map(({ session, summary }) => (
              <li key={session.id} className="flex items-center gap-3 py-2.5">
                <span className="text-lg">{WORK_MODE_EMOJI[session.work_mode]}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {nameByUser.get(session.user_id) ?? "—"}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {WORK_MODE_LABEL[session.work_mode]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {locationText(session)}
                    <span className="mx-1">·</span>
                    {formatDuration(summary.workedMs)} trabajados
                  </div>
                </div>
                <Badge variant="outline" className={cn(STATE_STYLE[summary.state])}>
                  {JORNADA_STATE_LABEL[summary.state]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
