import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, History } from "lucide-react";
import { WORK_MODE_EMOJI, WORK_MODE_LABEL, workedDuration } from "@/lib/rh";
import { useOrgAttendanceRange } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayKey = () => ymd(new Date());
const daysAgoKey = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};

function grossMs(checkIn: string, checkOut: string | null): number {
  if (!checkOut) return 0;
  return Math.max(0, new Date(checkOut).getTime() - new Date(checkIn).getTime());
}

function fmtHours(ms: number): string {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function fmtDay(ymdStr: string): string {
  return new Date(ymdStr + "T00:00:00").toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/** G4: historial de jornadas trabajadas por el equipo (rango de fechas, por colaborador). */
export function TeamJornadaHistory() {
  const [from, setFrom] = useState(daysAgoKey(13));
  const [to, setTo] = useState(todayKey());
  const [userId, setUserId] = useState<string>("all");
  const { data: rows = [], isLoading } = useOrgAttendanceRange(from, to, userId === "all" ? undefined : userId);
  const { data: users = [] } = useOrgUsers();

  const nameByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.full_name);
    return m;
  }, [users]);

  const totalMs = useMemo(() => rows.reduce((acc, r) => acc + grossMs(r.check_in_at, r.check_out_at), 0), [rows]);
  const byMode = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows) acc[r.work_mode] = (acc[r.work_mode] ?? 0) + 1;
    return acc;
  }, [rows]);

  // Agrupa por fecha (desc, ya viene ordenado).
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = m.get(r.work_date) ?? [];
      arr.push(r);
      m.set(r.work_date, arr);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" />
          Historial de jornadas del equipo
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
          <span className="text-xs text-muted-foreground">a</span>
          <Input type="date" value={to} min={from} max={todayKey()} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el equipo</SelectItem>
              {users.filter((u) => u.is_active).map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{rows.length} jornada(s)</Badge>
          <Badge variant="secondary">⏱️ {fmtHours(totalMs)} trabajadas</Badge>
          {byMode.office ? <Badge variant="secondary">🏢 {byMode.office}</Badge> : null}
          {byMode.home_office ? <Badge variant="secondary">🏠 {byMode.home_office}</Badge> : null}
          {byMode.commission ? <Badge variant="secondary">🚗 {byMode.commission}</Badge> : null}
          {byMode.client ? <Badge variant="secondary">🤝 {byMode.client}</Badge> : null}
        </div>

        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin jornadas registradas en este rango.
          </p>
        ) : (
          <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {groups.map(([date, dayRows]) => (
              <div key={date}>
                <p className="sticky top-0 bg-background py-1 text-xs font-semibold text-muted-foreground">
                  {fmtDay(date)}
                </p>
                <ul className="divide-y">
                  {dayRows.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2">
                      <span className="text-base">{WORK_MODE_EMOJI[a.work_mode]}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {nameByUser.get(a.user_id) ?? "—"}
                          <span className="ml-2 font-normal text-muted-foreground">{WORK_MODE_LABEL[a.work_mode]}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtTime(a.check_in_at)}
                          {a.check_out_at ? ` – ${fmtTime(a.check_out_at)} · ${workedDuration(a.check_in_at, a.check_out_at)}` : " · sin salida"}
                          {a.is_additional_shift ? " · turno extra" : ""}
                          {a.auto_closed ? " · cierre auto" : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
