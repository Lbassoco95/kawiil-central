import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Clock, Users, CalendarClock, CalendarDays, Briefcase, FolderArchive, ClipboardList, BarChart3, LayoutDashboard, BookOpen } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { GuiaRHDialog } from "./tablero/GuiaRHDialog";
import { useCanAccessRecruitment } from "@/hooks/useRecruitment";
import { ReclutamientoPanel } from "./recruitment/ReclutamientoPanel";
import { MiExpedientePanel } from "./expediente/MiExpedientePanel";
import { ExpedientesEquipoPanel } from "./expediente/ExpedientesEquipoPanel";
import { CuestionariosPanel } from "./cuestionarios/CuestionariosPanel";
import { ResultadosRHPanel } from "./cuestionarios/ResultadosRHPanel";
import { TableroRHPanel } from "./tablero/TableroRHPanel";
import { PendingCheckoutBanner, CheckoutApprovalsCard } from "./CheckoutCorrection";
import { JornadaCard } from "./JornadaCard";
import { MyAttendanceList } from "./MyAttendanceList";
import { SolicitudesPanel } from "./SolicitudesPanel";
import { TeamScheduleManager } from "./TeamScheduleManager";
import { TeamAttendanceBoard } from "./TeamAttendanceBoard";
import { TeamLivePresence } from "./TeamLivePresence";
import { TeamAbsencesToday, TeamAbsenceCalendar } from "./TeamAbsences";
import { OfficeLocationsManager } from "./OfficeLocationsManager";

/**
 * Experiencia de Recursos Humanos embebida en el Hub.
 * - "Mi jornada": disponible para todo el equipo (check-in/out con geolocalización).
 * - "Equipo" y "Turnos": solo para G4 (transformador).
 */
const RH_TABS = ["jornada", "solicitudes", "expediente", "cuestionarios", "reclutamiento", "tablero-rh", "equipo", "turnos", "expedientes", "resultados-rh"];

export function RecursosHumanosPanel() {
  const { isTransformador } = useUserRole();
  const canRecruit = useCanAccessRecruitment();
  const [guiaOpen, setGuiaOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const rhParam = searchParams.get("rh");
  const initialTab = rhParam && RH_TABS.includes(rhParam) ? rhParam : "jornada";

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Registra tu jornada y modalidad (oficina, home office o de comisión).
          {isTransformador && " Como G4, administra turnos, horarios y asistencia del equipo."}
        </p>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setGuiaOpen(true)}>
          <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Guía
        </Button>
      </div>
      <GuiaRHDialog open={guiaOpen} onOpenChange={setGuiaOpen} isG4={isTransformador} />

      {/* Aviso de jornada sin salida (declarar hora aprox. → aprobación G4). */}
      <PendingCheckoutBanner />

      <Tabs defaultValue={initialTab}>
        {/* Barra en una sola fila con scroll horizontal; agrupada por bloques. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="inline-flex w-max justify-start gap-0.5">
            {/* Personal (todos) */}
            <TabsTrigger value="jornada" className="px-2.5">
              <Clock className="mr-1.5 h-4 w-4" /> Mi jornada
            </TabsTrigger>
            <TabsTrigger value="solicitudes" className="px-2.5">
              <CalendarDays className="mr-1.5 h-4 w-4" /> Solicitudes
            </TabsTrigger>
            <TabsTrigger value="expediente" className="px-2.5">
              <FolderArchive className="mr-1.5 h-4 w-4" /> Mi expediente
            </TabsTrigger>
            <TabsTrigger value="cuestionarios" className="px-2.5">
              <ClipboardList className="mr-1.5 h-4 w-4" /> Cuestionarios
            </TabsTrigger>

            {/* Reclutamiento (reclutadores y G4) */}
            {canRecruit && (
              <>
                <span aria-hidden className="mx-1 h-5 w-px shrink-0 self-center bg-border" />
                <TabsTrigger value="reclutamiento" className="px-2.5">
                  <Briefcase className="mr-1.5 h-4 w-4" /> Reclutamiento
                </TabsTrigger>
              </>
            )}

            {/* Gestión (solo G4) */}
            {isTransformador && (
              <>
                <span aria-hidden className="mx-1 h-5 w-px shrink-0 self-center bg-border" />
                <TabsTrigger value="tablero-rh" className="px-2.5">
                  <LayoutDashboard className="mr-1.5 h-4 w-4" /> Tablero
                </TabsTrigger>
                <TabsTrigger value="equipo" className="px-2.5">
                  <Users className="mr-1.5 h-4 w-4" /> Equipo
                </TabsTrigger>
                <TabsTrigger value="turnos" className="px-2.5">
                  <CalendarClock className="mr-1.5 h-4 w-4" /> Turnos
                </TabsTrigger>
                <TabsTrigger value="expedientes" className="px-2.5">
                  <FolderArchive className="mr-1.5 h-4 w-4" /> Expedientes
                </TabsTrigger>
                <TabsTrigger value="resultados-rh" className="px-2.5">
                  <BarChart3 className="mr-1.5 h-4 w-4" /> Resultados
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </div>

        <TabsContent value="jornada" className="mt-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <JornadaCard />
            <MyAttendanceList />
          </div>
        </TabsContent>

        <TabsContent value="solicitudes" className="mt-5">
          <SolicitudesPanel />
        </TabsContent>

        <TabsContent value="expediente" className="mt-5">
          <MiExpedientePanel />
        </TabsContent>

        <TabsContent value="cuestionarios" className="mt-5">
          <CuestionariosPanel />
        </TabsContent>

        {canRecruit && (
          <TabsContent value="reclutamiento" className="mt-5">
            <ReclutamientoPanel />
          </TabsContent>
        )}

        {isTransformador && (
          <>
            <TabsContent value="tablero-rh" className="mt-5">
              <TableroRHPanel />
            </TabsContent>
            <TabsContent value="equipo" className="mt-5">
              <div className="grid gap-5">
                <CheckoutApprovalsCard />
                <div className="grid gap-5 lg:grid-cols-2">
                  <TeamLivePresence />
                  <TeamAbsencesToday />
                </div>
                <TeamAbsenceCalendar />
                <TeamAttendanceBoard />
              </div>
            </TabsContent>
            <TabsContent value="turnos" className="mt-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <TeamScheduleManager />
                <OfficeLocationsManager />
              </div>
            </TabsContent>
            <TabsContent value="expedientes" className="mt-5">
              <ExpedientesEquipoPanel />
            </TabsContent>
            <TabsContent value="resultados-rh" className="mt-5">
              <ResultadosRHPanel />
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
