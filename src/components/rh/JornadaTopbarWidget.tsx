import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Clock,
  Coffee,
  Utensils,
  Car,
  CalendarPlus,
  Wind,
  FolderArchive,
  ClipboardList,
  LogIn,
  LogOut,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORK_MODES,
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  formatDuration,
  plannedModeForToday,
  type RhAbsenceType,
} from "@/lib/rh";
import { useJornada, useTransitStatus, useChangeWorkMode } from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployeeDocuments } from "@/hooks/useExpediente";
import { useMyPendingQuestionnaires } from "@/hooks/useQuestionnaires";
import { EXPEDIENTE_DOC_TYPES, expedienteProgress } from "@/lib/expediente";
import { AbsenceRequestDialog } from "./AbsenceRequestDialog";

/**
 * Widget compacto de jornada para la barra superior.
 * Siempre visible: muestra el estado y el siguiente paso de la jornada.
 */
export function JornadaTopbarWidget() {
  const { session, schedule, summary, isPending, act } = useJornada();
  const plannedMode = plannedModeForToday(schedule);
  const transit = useTransitStatus();
  const changeMode = useChangeWorkMode();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: docs = [] } = useEmployeeDocuments(user?.id ?? null);
  const pendingQ = useMyPendingQuestionnaires();
  const inTransit = !!session?.in_transit;
  const [absOpen, setAbsOpen] = useState(false);
  const [absType, setAbsType] = useState<RhAbsenceType | undefined>(undefined);

  const expedientePending = expedienteProgress(docs).uploaded < EXPEDIENTE_DOC_TYPES.length;

  // Sin iniciar o jornada cerrada: botón "Iniciar" con menú para elegir modalidad.
  if (summary.state === "none" || summary.state === "done") {
    const done = summary.state === "done";
    return (
      <div className="flex items-center gap-2">
        {done && (
          <span className="hidden items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground sm:flex">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(summary.workedMs)} hoy
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5" disabled={isPending}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{done ? "Iniciar otra" : "Iniciar jornada"}</span>
              <ChevronDown className="h-3 w-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Iniciar desde…</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {WORK_MODES.map((mode) => (
              <DropdownMenuItem key={mode} onClick={() => act({ type: "check_in", workMode: mode })}>
                <span className="mr-2">{WORK_MODE_EMOJI[mode]}</span>
                {WORK_MODE_LABEL[mode]}
                {plannedMode === mode && <span className="ml-auto text-[10px] text-muted-foreground">turno</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // En comida: regresar
  if (summary.state === "lunch") {
    return (
      <Button size="sm" className="h-8 gap-1.5" disabled={isPending} onClick={() => act({ type: "lunch_end" })}>
        <Utensils className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Regresar de comer</span>
      </Button>
    );
  }

  // En descanso: terminar
  if (summary.state === "break") {
    return (
      <Button size="sm" className="h-8 gap-1.5" disabled={isPending} onClick={() => act({ type: "break_end" })}>
        <Coffee className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Terminar descanso</span>
      </Button>
    );
  }

  // Trabajando: pill con tiempo + menú de acciones
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300/70 bg-emerald-50/70 px-2.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100/70",
            "dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300",
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="hidden sm:inline">{formatDuration(summary.workedMs)}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>En jornada · {formatDuration(summary.workedMs)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!session?.is_additional_shift && (
          <DropdownMenuItem onClick={() => act({ type: "lunch_start" })}>
            <Utensils className="mr-2 h-4 w-4" />
            Ir a comer
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={!summary.canBreak}
          onClick={() => act({ type: "break_start" })}
        >
          <Coffee className="mr-2 h-4 w-4" />
          Descanso (20 min)
          {!summary.canBreak && summary.nextBreakAt && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {new Date(summary.nextBreakAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => transit.mutate({ on: !inTransit, workMode: session?.work_mode ?? "office", attendanceId: session?.id ?? null })}
        >
          <Car className="mr-2 h-4 w-4" />
          {inTransit ? "Llegué (salir de trayecto)" : "En trayecto"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
          ¿Dónde estás?
        </DropdownMenuLabel>
        {WORK_MODES.map((mode) => {
          const active = (session?.work_mode ?? "office") === mode && !inTransit;
          return (
            <DropdownMenuItem
              key={mode}
              disabled={active}
              onClick={() => session && changeMode.mutate({ attendanceId: session.id, workMode: mode })}
            >
              <span className="mr-2">{WORK_MODE_EMOJI[mode]}</span>
              {WORK_MODE_LABEL[mode]}
              {active && <span className="ml-auto text-[10px] text-muted-foreground">actual</span>}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
          Solicitar
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => { setAbsType(undefined); setAbsOpen(true); }}>
          <CalendarPlus className="mr-2 h-4 w-4" />
          Solicitar día / permiso
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { setAbsType("burnout"); setAbsOpen(true); }}>
          <Wind className="mr-2 h-4 w-4" />
          Día de burnout
        </DropdownMenuItem>
        {expedientePending && (
          <DropdownMenuItem onClick={() => navigate("/hub?tab=rh&rh=expediente")}>
            <FolderArchive className="mr-2 h-4 w-4" />
            Completar expediente
          </DropdownMenuItem>
        )}
        {pendingQ > 0 && (
          <DropdownMenuItem onClick={() => navigate("/hub?tab=rh&rh=cuestionarios")}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Responder cuestionario
            <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[10px] font-medium text-white">{pendingQ}</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          onClick={() => act({ type: "check_out" })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Terminar jornada
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AbsenceRequestDialog open={absOpen} onOpenChange={setAbsOpen} defaultType={absType} />
    </>
  );
}
