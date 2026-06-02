import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import {
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  evaluateCompliance,
  workedDuration,
} from "@/lib/rh";
import { useOrgAttendance } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";

const COMPLIANCE_VARIANT: Record<string, string> = {
  compliant: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  mismatch: "border-amber-300 text-amber-700 dark:text-amber-400",
  geofence_fail: "border-red-300 text-red-700 dark:text-red-400",
  unknown: "border-border text-muted-foreground",
};

const todayKey = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function TeamAttendanceBoard() {
  const [date, setDate] = useState(todayKey());
  const { data: rows = [], isLoading } = useOrgAttendance(date);
  const { data: users = [] } = useOrgUsers();

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.full_name);
    return m;
  }, [users]);

  const summary = useMemo(() => {
    const acc = { office: 0, home_office: 0, commission: 0 };
    for (const r of rows) acc[r.work_mode] += 1;
    return acc;
  }, [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" />
          Asistencia del equipo
        </CardTitle>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 w-auto"
        />
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">🏢 Oficina: {summary.office}</Badge>
          <Badge variant="secondary">🏠 Home Office: {summary.home_office}</Badge>
          <Badge variant="secondary">🚗 Comisión: {summary.commission}</Badge>
        </div>

        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin registros de asistencia para esta fecha.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((a) => {
              const c = evaluateCompliance({
                actual: a.work_mode,
                expected: a.expected_work_mode,
                withinGeofence: a.within_geofence,
              });
              return (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-lg">{WORK_MODE_EMOJI[a.work_mode]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {nameByUser.get(a.user_id) ?? "—"}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {WORK_MODE_LABEL[a.work_mode]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.check_in_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                      {a.check_out_at
                        ? ` – ${new Date(a.check_out_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · ${workedDuration(a.check_in_at, a.check_out_at)}`
                        : " · en curso"}
                    </div>
                  </div>
                  <Badge variant="outline" className={COMPLIANCE_VARIANT[c.status]}>
                    {c.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
