import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, CalendarOff, CalendarRange } from "lucide-react";
import {
  ABSENCE_TYPE_EMOJI,
  ABSENCE_TYPE_LABEL,
  DAY_PART_LABEL,
  absenceCoversDate,
  ymd,
  type RhAbsenceRequest,
} from "@/lib/rh";
import { useApprovedAbsences } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";

function useNames() {
  const { data: users = [] } = useOrgUsers();
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.full_name);
    return m;
  }, [users]);
}

/** Tarjeta "Ausentes hoy". */
export function TeamAbsencesToday() {
  const { data: absences = [], isLoading } = useApprovedAbsences();
  const names = useNames();
  const today = ymd();
  const todays = absences.filter((a) => absenceCoversDate(a, today));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarOff className="h-4 w-4 text-amber-500" />
          Ausentes hoy
          {todays.length > 0 && <Badge variant="secondary" className="ml-1">{todays.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : todays.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nadie tiene ausencia aprobada hoy.</p>
        ) : (
          <ul className="divide-y">
            {todays.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="text-lg">{ABSENCE_TYPE_EMOJI[a.absence_type]}</span>
                <span className="flex-1 truncate">{names.get(a.user_id) ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {ABSENCE_TYPE_LABEL[a.absence_type]} · {DAY_PART_LABEL[a.day_part]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Calendario mensual de ausencias del equipo. */
export function TeamAbsenceCalendar() {
  const { data: absences = [], isLoading } = useApprovedAbsences();
  const names = useNames();
  const [selected, setSelected] = useState<Date>(new Date());

  // Días con al menos una ausencia (para resaltar en el calendario).
  const absentDays = useMemo(() => {
    const days: Date[] = [];
    const seen = new Set<string>();
    for (const a of absences) {
      const start = new Date(a.start_date + "T00:00:00");
      const end = new Date(a.end_date + "T00:00:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = ymd(d);
        if (!seen.has(key)) {
          seen.add(key);
          days.push(new Date(d));
        }
      }
    }
    return days;
  }, [absences]);

  const selectedYmd = ymd(selected);
  const dayList = absences.filter((a) => absenceCoversDate(a, selectedYmd));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-primary" />
          Calendario de ausencias
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(d) => d && setSelected(d)}
              modifiers={{ absent: absentDays }}
              modifiersClassNames={{
                absent: "relative after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-amber-500",
              }}
              className="rounded-md border"
            />
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-sm font-medium">
                {selected.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              {dayList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin ausencias este día.</p>
              ) : (
                <ul className="space-y-1.5">
                  {dayList.map((a: RhAbsenceRequest) => (
                    <li key={a.id} className="flex items-center gap-2 text-sm">
                      <span>{ABSENCE_TYPE_EMOJI[a.absence_type]}</span>
                      <span className="flex-1 truncate">{names.get(a.user_id) ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{DAY_PART_LABEL[a.day_part]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
