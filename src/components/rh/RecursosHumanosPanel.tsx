import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, Users, CalendarClock, CalendarDays, Briefcase, FolderArchive, ClipboardList, BarChart3 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useCanAccessRecruitment } from "@/hooks/useRecruitment";
import { ReclutamientoPanel } from "./recruitment/ReclutamientoPanel";
import { MiExpedientePanel } from "./expediente/MiExpedientePanel";
import { ExpedientesEquipoPanel } from "./expediente/ExpedientesEquipoPanel";
import { CuestionariosPanel } from "./cuestionarios/CuestionariosPanel";
import { ResultadosRHPanel } from "./cuestionarios/ResultadosRHPanel";
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
export function RecursosHumanosPanel() {
  const { isTransformador } = useUserRole();
  const canRecruit = useCanAccessRecruitment();

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Registra tu jornada y modalidad (oficina, home office o de comisión).
        {isTransformador && " Como G4, administra turnos, horarios y asistencia del equipo."}
      </p>

      <Tabs defaultValue="jornada">
        <TabsList className="flex-wrap">
          <TabsTrigger value="jornada">
            <Clock className="mr-1.5 h-4 w-4" />
            Mi jornada
          </TabsTrigger>
          <TabsTrigger value="solicitudes">
            <CalendarDays className="mr-1.5 h-4 w-4" />
            Solicitudes
          </TabsTrigger>
          <TabsTrigger value="expediente">
            <FolderArchive className="mr-1.5 h-4 w-4" />
            Mi expediente
          </TabsTrigger>
          <TabsTrigger value="cuestionarios">
            <ClipboardList className="mr-1.5 h-4 w-4" />
            Cuestionarios
          </TabsTrigger>
          {isTransformador && (
            <>
              <TabsTrigger value="equipo">
                <Users className="mr-1.5 h-4 w-4" />
                Equipo
              </TabsTrigger>
              <TabsTrigger value="turnos">
                <CalendarClock className="mr-1.5 h-4 w-4" />
                Turnos y horarios
              </TabsTrigger>
              <TabsTrigger value="expedientes">
                <FolderArchive className="mr-1.5 h-4 w-4" />
                Expedientes
              </TabsTrigger>
              <TabsTrigger value="resultados-rh">
                <BarChart3 className="mr-1.5 h-4 w-4" />
                Resultados RH
              </TabsTrigger>
            </>
          )}
          {canRecruit && (
            <TabsTrigger value="reclutamiento">
              <Briefcase className="mr-1.5 h-4 w-4" />
              Reclutamiento
            </TabsTrigger>
          )}
        </TabsList>

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
            <TabsContent value="equipo" className="mt-5">
              <div className="grid gap-5">
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
