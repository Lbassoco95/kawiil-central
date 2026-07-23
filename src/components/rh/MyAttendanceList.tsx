import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { History, Loader2, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  evaluateCompliance,
  workedDuration,
  type RhAttendance,
} from "@/lib/rh";
import { useMyAttendance, useProposeCheckinCorrection } from "@/hooks/useRh";

const COMPLIANCE_VARIANT: Record<string, string> = {
  compliant: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  mismatch: "border-amber-300 text-amber-700 dark:text-amber-400",
  geofence_fail: "border-red-300 text-red-700 dark:text-red-400",
  unknown: "border-border text-muted-foreground",
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

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
            {data.map((a) => (
              <AttendanceRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceRow({ a }: { a: RhAttendance }) {
  const propose = useProposeCheckinCorrection();
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(hhmm(a.check_in_at));

  const c = evaluateCompliance({
    actual: a.work_mode,
    expected: a.expected_work_mode,
    withinGeofence: a.within_geofence,
  });

  function submit() {
    if (!time) return;
    propose.mutate(
      { id: a.id, proposedAt: new Date(`${a.work_date}T${time}:00`).toISOString() },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-xl">{WORK_MODE_EMOJI[a.work_mode]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {new Date(a.work_date + "T00:00:00").toLocaleDateString("es-MX", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
            <span className="ml-2 font-normal text-muted-foreground">{WORK_MODE_LABEL[a.work_mode]}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {hhmm(a.check_in_at)}
            {a.check_out_at ? ` – ${hhmm(a.check_out_at)} · ${workedDuration(a.check_in_at, a.check_out_at)}` : " · en curso"}
          </div>
        </div>
        {a.checkin_review === "pending_g4" ? (
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
            Entrada por aprobar
          </Badge>
        ) : (
          <Badge variant="outline" className={COMPLIANCE_VARIANT[c.status]}>
            {c.label}
          </Badge>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          title="Corregir hora de entrada"
          onClick={() => setEditing((v) => !v)}
        >
          <PencilLine className="h-3.5 w-3.5" />
        </Button>
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
          <span className="text-xs text-muted-foreground">Entré a las</span>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-28" />
          <Button size="sm" disabled={propose.isPending || !time} onClick={submit}>
            {propose.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Enviar a mi G4
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          <span className={cn("w-full text-[10px] text-muted-foreground")}>
            Tu G4 de célula revisará y aprobará la corrección.
          </span>
        </div>
      )}
    </li>
  );
}
