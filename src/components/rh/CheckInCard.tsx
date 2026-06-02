import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Clock,
  LogIn,
  LogOut,
  MapPin,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  WORK_MODES,
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  evaluateCompliance,
  formatTime,
  getCurrentPosition,
  matchOffice,
  plannedModeForToday,
  workedDuration,
  type RhWorkMode,
} from "@/lib/rh";
import {
  useCheckIn,
  useCheckOut,
  useMyWorkSchedule,
  useOfficeLocations,
  useTodayAttendance,
} from "@/hooks/useRh";

export function CheckInCard() {
  const { data: schedule } = useMyWorkSchedule();
  const { data: offices = [] } = useOfficeLocations();
  const { data: today, isLoading } = useTodayAttendance();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();

  const plannedMode = useMemo(() => plannedModeForToday(schedule), [schedule]);
  const [selectedMode, setSelectedMode] = useState<RhWorkMode>(plannedMode ?? "office");
  const [notes, setNotes] = useState("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Sincroniza el modo por defecto con el turno planificado cuando llega.
  useEffect(() => {
    if (plannedMode) setSelectedMode(plannedMode);
  }, [plannedMode]);

  const isCheckedIn = !!today && !today.check_out_at;
  const isClosed = !!today && !!today.check_out_at;

  async function handleCheckIn() {
    setGeoError(null);
    setLocating(true);
    let fix = null;
    let withinGeofence: boolean | null = null;
    let officeLocationId: string | null = null;
    try {
      fix = await getCurrentPosition();
      if (selectedMode === "office" && offices.length > 0) {
        const m = matchOffice(fix, offices);
        withinGeofence = !!m;
        officeLocationId = m?.office.id ?? null;
      }
    } catch (e) {
      // La ubicación es deseable pero no bloquea el registro.
      setGeoError((e as Error).message);
      if (selectedMode === "office" && offices.length > 0) withinGeofence = false;
    } finally {
      setLocating(false);
    }
    checkIn.mutate({
      workMode: selectedMode,
      expectedWorkMode: plannedMode,
      fix,
      withinGeofence,
      officeLocationId,
      notes: notes.trim() || null,
    });
  }

  async function handleCheckOut() {
    if (!today) return;
    let fix = null;
    try {
      fix = await getCurrentPosition();
    } catch {
      /* ignore — la salida no requiere ubicación */
    }
    checkOut.mutate({ id: today.id, fix });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // -------- Jornada en curso --------
  if (isCheckedIn && today) {
    const compliance = evaluateCompliance({
      actual: today.work_mode,
      expected: today.expected_work_mode,
      withinGeofence: today.within_geofence,
    });
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-emerald-500" />
            Jornada en curso
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{WORK_MODE_EMOJI[today.work_mode]}</span>
            <div>
              <div className="font-semibold">{WORK_MODE_LABEL[today.work_mode]}</div>
              <div className="text-sm text-muted-foreground">
                Entrada {new Date(today.check_in_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {workedDuration(today.check_in_at, null)} trabajadas
              </div>
            </div>
          </div>

          <ComplianceBanner status={compliance.status} label={compliance.label} detail={compliance.detail} />

          <Button
            onClick={handleCheckOut}
            disabled={checkOut.isPending}
            variant="outline"
            className="w-full"
          >
            {checkOut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            Registrar salida
          </Button>
        </CardContent>
      </Card>
    );
  }

  // -------- Jornada cerrada --------
  if (isClosed && today) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Jornada completada
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{WORK_MODE_EMOJI[today.work_mode]}</span>
            <span className="font-medium">{WORK_MODE_LABEL[today.work_mode]}</span>
          </div>
          <p className="text-muted-foreground">
            {new Date(today.check_in_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
            {" – "}
            {today.check_out_at &&
              new Date(today.check_out_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
            {" · "}
            {workedDuration(today.check_in_at, today.check_out_at)} en total
          </p>
        </CardContent>
      </Card>
    );
  }

  // -------- Sin registro hoy: formulario de entrada --------
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LogIn className="h-4 w-4 text-primary" />
          Registrar entrada
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {schedule ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{schedule.shift_label}</div>
            <div className="text-muted-foreground">
              {formatTime(schedule.start_time)}–{formatTime(schedule.end_time)}
              {plannedMode
                ? ` · Hoy te toca: ${WORK_MODE_EMOJI[plannedMode]} ${WORK_MODE_LABEL[plannedMode]}`
                : " · Hoy es día de descanso"}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Aún no tienes un turno asignado por tu G4. Puedes registrar tu entrada de todos modos.
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-medium">¿Desde dónde trabajas hoy?</p>
          <div className="grid grid-cols-3 gap-2">
            {WORK_MODES.map((mode) => {
              const active = selectedMode === mode;
              const isPlanned = plannedMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSelectedMode(mode)}
                  className={cn(
                    "relative flex flex-col items-center gap-1 rounded-lg border p-3 text-center text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:bg-muted/60",
                  )}
                >
                  <span className="text-xl">{WORK_MODE_EMOJI[mode]}</span>
                  <span className="font-medium">{WORK_MODE_LABEL[mode]}</span>
                  {isPlanned && (
                    <Badge variant="secondary" className="absolute -top-2 right-1 px-1.5 py-0 text-[9px]">
                      turno
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {selectedMode === "office" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            Validaremos tu ubicación contra la geocerca de la oficina.
          </p>
        )}

        {plannedMode && selectedMode !== plannedMode && (
          <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Tu turno indica {WORK_MODE_LABEL[plannedMode]}; quedará registrado como excepción.
          </p>
        )}

        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota opcional (ej. cliente que visitas si estás de comisión)"
          rows={2}
          className="text-sm"
        />

        {geoError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{geoError}</p>
        )}

        <Button onClick={handleCheckIn} disabled={locating || checkIn.isPending} className="w-full">
          {locating || checkIn.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-2 h-4 w-4" />
          )}
          {locating ? "Obteniendo ubicación…" : "Registrar entrada"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ComplianceBanner({
  status,
  label,
  detail,
}: {
  status: ReturnType<typeof evaluateCompliance>["status"];
  label: string;
  detail: string;
}) {
  const styles: Record<string, string> = {
    compliant: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
    mismatch: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
    geofence_fail: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    unknown: "bg-muted text-muted-foreground",
  };
  const Icon = status === "compliant" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-2 rounded-md p-2.5 text-xs", styles[status])}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <div className="font-medium">{label}</div>
        <div className="opacity-90">{detail}</div>
      </div>
    </div>
  );
}
