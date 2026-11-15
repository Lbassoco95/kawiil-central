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
import { Button } from "@/components/ui/button";
import { Loader2, History, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { WORK_MODE_EMOJI, WORK_MODE_LABEL, workedDuration } from "@/lib/rh";
import { useOrgAttendanceRange } from "@/hooks/useRh";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { AttendanceLocationButton } from "./AttendanceLocationButton";

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

  /** Descarga el reporte (Excel): hoja de detalle + resumen por colaborador. */
  const handleDownload = () => {
    if (rows.length === 0) {
      toast.error("No hay jornadas para descargar en este rango.");
      return;
    }
    const nameOf = (id: string) => nameByUser.get(id) ?? "—";
    const dateTime = (iso: string | null) =>
      iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "";
    const hoursOf = (ms: number) => Math.round((ms / 3600000) * 100) / 100;

    const sorted = [...rows].sort((a, b) =>
      nameOf(a.user_id).localeCompare(nameOf(b.user_id), "es") ||
      a.check_in_at.localeCompare(b.check_in_at),
    );

    const detalle = sorted.map((r) => ({
      Colaborador: nameOf(r.user_id),
      Fecha: r.work_date,
      Modalidad: WORK_MODE_LABEL[r.work_mode] ?? r.work_mode,
      Entrada: fmtTime(r.check_in_at),
      Salida: r.check_out_at ? fmtTime(r.check_out_at) : "Sin salida",
      "Duración": r.check_out_at ? workedDuration(r.check_in_at, r.check_out_at) : "",
      "Horas trabajadas": r.check_out_at ? hoursOf(grossMs(r.check_in_at, r.check_out_at)) : 0,
      "Turno extra": r.is_additional_shift ? "Sí" : "No",
      "Cierre automático": r.auto_closed ? "Sí" : "No",
      "Dentro de geocerca": r.within_geofence == null ? "" : r.within_geofence ? "Sí" : "No",
      "Latitud entrada": r.check_in_lat ?? "",
      "Longitud entrada": r.check_in_lng ?? "",
      "Latitud salida": r.check_out_lat ?? "",
      "Longitud salida": r.check_out_lng ?? "",
      Notas: r.notes ?? "",
    }));

    const perUser = new Map<string, { jornadas: number; ms: number; modes: Record<string, number> }>();
    for (const r of rows) {
      const s = perUser.get(r.user_id) ?? { jornadas: 0, ms: 0, modes: {} };
      s.jornadas += 1;
      s.ms += grossMs(r.check_in_at, r.check_out_at);
      s.modes[r.work_mode] = (s.modes[r.work_mode] ?? 0) + 1;
      perUser.set(r.user_id, s);
    }
    const resumen = [...perUser.entries()]
      .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), "es"))
      .map(([id, s]) => ({
        Colaborador: nameOf(id),
        Jornadas: s.jornadas,
        "Horas trabajadas": hoursOf(s.ms),
        "Total (h m)": fmtHours(s.ms),
        Oficina: s.modes.office ?? 0,
        "Home office": s.modes.home_office ?? 0,
        "Comisión": s.modes.commission ?? 0,
        Cliente: s.modes.client ?? 0,
      }));

    const wb = XLSX.utils.book_new();
    const wsResumen = XLSX.utils.json_to_sheet(resumen);
    const wsDetalle = XLSX.utils.json_to_sheet(detalle);
    wsResumen["!cols"] = [{ wch: 32 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 10 }, { wch: 9 }];
    wsDetalle["!cols"] = [{ wch: 32 }, { wch: 11 }, { wch: 12 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle de jornadas");

    const who =
      userId === "all"
        ? "equipo"
        : nameOf(userId).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, "_");
    XLSX.writeFile(wb, `jornadas_${who}_${from}_a_${to}.xlsx`);
    toast.success("Reporte descargado");
  };

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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleDownload}
            disabled={isLoading || rows.length === 0}
          >
            <Download className="h-4 w-4" />
            Descargar
          </Button>
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
                      <AttendanceLocationButton attendance={a} personName={nameByUser.get(a.user_id) ?? "—"} />
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
