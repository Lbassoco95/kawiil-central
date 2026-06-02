import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, Users, CalendarClock } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { JornadaCard } from "./JornadaCard";
import { MyAttendanceList } from "./MyAttendanceList";
import { TeamScheduleManager } from "./TeamScheduleManager";
import { TeamAttendanceBoard } from "./TeamAttendanceBoard";
import { OfficeLocationsManager } from "./OfficeLocationsManager";

/**
 * Experiencia de Recursos Humanos embebida en el Hub.
 * - "Mi jornada": disponible para todo el equipo (check-in/out con geolocalización).
 * - "Equipo" y "Turnos": solo para G4 (transformador).
 */
export function RecursosHumanosPanel() {
  const { isTransformador } = useUserRole();

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
            </>
          )}
        </TabsList>

        <TabsContent value="jornada" className="mt-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <JornadaCard />
            <MyAttendanceList />
          </div>
        </TabsContent>

        {isTransformador && (
          <>
            <TabsContent value="equipo" className="mt-5">
              <TeamAttendanceBoard />
            </TabsContent>
            <TabsContent value="turnos" className="mt-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <TeamScheduleManager />
                <OfficeLocationsManager />
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
