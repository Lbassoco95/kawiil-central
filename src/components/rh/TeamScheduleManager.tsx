import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarClock, Pencil } from "lucide-react";
import {
  EMPLOYMENT_TYPE_LABEL,
  ISO_WEEKDAYS,
  WORK_MODE_EMOJI,
  formatTime,
  type RhWorkSchedule,
} from "@/lib/rh";
import { useOrgSchedules } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { ScheduleEditDialog } from "./ScheduleEditDialog";

export function TeamScheduleManager() {
  const { data: users = [], isLoading } = useOrgUsers();
  const { data: schedules = [] } = useOrgSchedules();
  const [editing, setEditing] = useState<{ userId: string; userName: string } | null>(null);

  const scheduleByUser = useMemo(() => {
    const m = new Map<string, RhWorkSchedule>();
    for (const s of schedules) m.set(s.user_id, s);
    return m;
  }, [schedules]);

  const activeUsers = users.filter((u) => u.is_active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-primary" />
          Turnos del equipo
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="divide-y">
            {activeUsers.map((u) => {
              const sched = scheduleByUser.get(u.user_id);
              return (
                <li key={u.user_id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{u.full_name}</div>
                    {sched ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>
                          {sched.shift_label} · {EMPLOYMENT_TYPE_LABEL[sched.employment_type ?? "full_time"]} · {formatTime(sched.start_time)}–{formatTime(sched.end_time)}
                        </span>
                        <span className="flex gap-0.5">
                          {ISO_WEEKDAYS.map(({ key, short }) => {
                            const mode = sched.weekly_plan?.[key];
                            return (
                              <span
                                key={key}
                                title={short}
                                className="inline-flex h-5 w-5 items-center justify-center rounded text-[11px]"
                              >
                                {mode ? WORK_MODE_EMOJI[mode] : "·"}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        Sin turno asignado
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing({ userId: u.user_id, userName: u.full_name })}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {sched ? "Editar" : "Asignar"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {editing && (
        <ScheduleEditDialog
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          userId={editing.userId}
          userName={editing.userName}
          existing={scheduleByUser.get(editing.userId) ?? null}
        />
      )}
    </Card>
  );
}
