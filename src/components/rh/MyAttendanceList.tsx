import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, Loader2 } from "lucide-react";
import {
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  evaluateCompliance,
  workedDuration,
} from "@/lib/rh";
import { useMyAttendance } from "@/hooks/useRh";

const COMPLIANCE_VARIANT: Record<string, string> = {
  compliant: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  mismatch: "border-amber-300 text-amber-700 dark:text-amber-400",
  geofence_fail: "border-red-300 text-red-700 dark:text-red-400",
  unknown: "border-border text-muted-foreground",
};

export function MyAttendanceList() {
  const { data = [], isLoading } = useMyAttendance(30);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Mi historial
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aún no tienes registros de asistencia.
          </p>
        ) : (
          <ul className="divide-y">
            {data.map((a) => {
              const c = evaluateCompliance({
                actual: a.work_mode,
                expected: a.expected_work_mode,
                withinGeofence: a.within_geofence,
              });
              return (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-xl">{WORK_MODE_EMOJI[a.work_mode]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {new Date(a.work_date + "T00:00:00").toLocaleDateString("es-MX", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
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
