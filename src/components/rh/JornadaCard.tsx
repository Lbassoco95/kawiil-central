import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  Utensils,
  MapPin,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  EMPLOYMENT_TYPE_LABEL,
  JORNADA_STATE_LABEL,
  WORK_MODES,
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  evaluateCompliance,
  formatDuration,
  formatTime,
  overtimeMinutes,
  plannedModeForToday,
  type RhWorkMode,
} from "@/lib/rh";
import { useJornada } from "@/hooks/useRh";

/** Re-render periódico para que los contadores avancen. */
function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

export function JornadaCard() {
  const { session, schedule, summary, isPending, act } = useJornada();
  const plannedMode = plannedModeForToday(schedule);
  const [selectedMode, setSelectedMode] = useState<RhWorkMode>(plannedMode ?? "office");

  useEffect(() => {
    if (plannedMode) setSelectedMode(plannedMode);
  }, [plannedMode]);

  useTicker(summary.state === "working" || summary.state === "lunch" || summary.state === "break");

  const overtime = overtimeMinutes(schedule, summary.workedMs);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-primary" />
          Mi jornada de hoy
        </CardTitle>
        <Badge
          variant="outline"
          className={cn(
            summary.state === "working" && "border-emerald-300 text-emerald-700 dark:text-emerald-400",
            summary.state === "lunch" && "border-amber-300 text-amber-700 dark:text-amber-400",
            summary.state === "break" && "border-sky-300 text-sky-700 dark:text-sky-400",
          )}
        >
          {JORNADA_STATE_LABEL[summary.state]}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Resumen del turno */}
        {schedule ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="font-medium">
              {schedule.shift_label}
              <span className="ml-2 font-normal text-muted-foreground">
                · {EMPLOYMENT_TYPE_LABEL[schedule.employment_type ?? "full_time"]}
              </span>
            </div>
            <div className="text-muted-foreground">
              {formatTime(schedule.start_time)}–{formatTime(schedule.end_time)} · comida {formatTime(schedule.lunch_start)}–{formatTime(schedule.lunch_end)}
              {plannedMode
                ? ` · Hoy: ${WORK_MODE_EMOJI[plannedMode]} ${WORK_MODE_LABEL[plannedMode]}`
                : " · Hoy es descanso"}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Aún no tienes un turno asignado por tu G4. Puedes iniciar tu jornada de todos modos.
          </div>
        )}

        {/* Contadores en vivo */}
        {summary.state !== "none" && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="Trabajado" value={formatDuration(summary.workedMs)} />
            <Metric label="Comida" value={formatDuration(summary.lunchMs)} />
            <Metric label="Descansos" value={`${summary.breaksTaken} · ${formatDuration(summary.breakMs)}`} />
          </div>
        )}

        {overtime > 0 && (
          <p className="flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-700 dark:bg-violet-900/20 dark:text-violet-400">
            <Clock className="h-3.5 w-3.5" />
            Tiempo extra acumulado: {formatDuration(overtime * 60000)}
          </p>
        )}

        {/* ---- Estado: sin iniciar ---- */}
        {summary.state === "none" && (
          <>
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
                        active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60",
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
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              Guardamos tu ubicación al registrar (también en home office y comisión).
            </p>
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() => act({ type: "check_in", workMode: selectedMode })}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
              Iniciar jornada
            </Button>
          </>
        )}

        {/* ---- Estado: trabajando ---- */}
        {summary.state === "working" && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={isPending} onClick={() => act({ type: "lunch_start" })}>
              <Utensils className="mr-2 h-4 w-4" />
              Ir a comer
            </Button>
            <Button
              variant="outline"
              disabled={isPending || !summary.canBreak}
              onClick={() => act({ type: "break_start" })}
              title={
                summary.canBreak
                  ? "Descanso de 20 min"
                  : summary.nextBreakAt
                    ? `Disponible a las ${new Date(summary.nextBreakAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`
                    : undefined
              }
            >
              <Coffee className="mr-2 h-4 w-4" />
              Descanso
            </Button>
            <Button
              variant="destructive"
              className="col-span-2"
              disabled={isPending}
              onClick={() => act({ type: "check_out" })}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              Terminar jornada
            </Button>
            {!summary.canBreak && summary.nextBreakAt && (
              <p className="col-span-2 text-center text-xs text-muted-foreground">
                Próximo descanso disponible a las{" "}
                {new Date(summary.nextBreakAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        {/* ---- Estado: comida ---- */}
        {summary.state === "lunch" && (
          <Button className="w-full" disabled={isPending} onClick={() => act({ type: "lunch_end" })}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Utensils className="mr-2 h-4 w-4" />}
            Regresar de comer
          </Button>
        )}

        {/* ---- Estado: descanso ---- */}
        {summary.state === "break" && (
          <Button className="w-full" disabled={isPending} onClick={() => act({ type: "break_end" })}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Coffee className="mr-2 h-4 w-4" />}
            Terminar descanso
          </Button>
        )}

        {/* ---- Estado: cerrada ---- */}
        {summary.state === "done" && session && (
          <div className="space-y-2">
            <Compliance session={session} />
            <p className="text-center text-sm text-muted-foreground">
              Trabajaste {formatDuration(summary.workedMs)} hoy. ¡Buen descanso!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Compliance({ session }: { session: NonNullable<ReturnType<typeof useJornada>["session"]> }) {
  const c = evaluateCompliance({
    actual: session.work_mode,
    expected: session.expected_work_mode,
    withinGeofence: session.within_geofence,
  });
  const Icon = c.status === "compliant" ? CheckCircle2 : AlertTriangle;
  const styles: Record<string, string> = {
    compliant: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
    mismatch: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
    geofence_fail: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    unknown: "bg-muted text-muted-foreground",
  };
  return (
    <div className={cn("flex items-start gap-2 rounded-md p-2.5 text-xs", styles[c.status])}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <div className="font-medium">{c.label}</div>
        <div className="opacity-90">{c.detail}</div>
      </div>
    </div>
  );
}
