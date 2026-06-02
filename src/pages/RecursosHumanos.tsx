import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, FolderArchive, ClipboardList, Lock } from "lucide-react";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import { useUserRole } from "@/hooks/useUserRole";
import { CheckInCard } from "@/components/rh/CheckInCard";
import { MyAttendanceList } from "@/components/rh/MyAttendanceList";
import { TeamScheduleManager } from "@/components/rh/TeamScheduleManager";
import { TeamAttendanceBoard } from "@/components/rh/TeamAttendanceBoard";
import { OfficeLocationsManager } from "@/components/rh/OfficeLocationsManager";

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Lock className="h-8 w-8 text-muted-foreground/50" />
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        <Badge variant="outline" className="mt-1">Próxima entrega</Badge>
      </CardContent>
    </Card>
  );
}

const RecursosHumanos = () => {
  const { isTransformador } = useUserRole();

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Personas", "Recursos Humanos"]}
          icon={<Users />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Recursos Humanos"
          description="Registra tu jornada, consulta tu turno y —si eres G4— administra al equipo."
        />

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
                  <Clock className="mr-1.5 h-4 w-4" />
                  Turnos
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="expedientes">
              <FolderArchive className="mr-1.5 h-4 w-4" />
              Expedientes
            </TabsTrigger>
            <TabsTrigger value="encuestas">
              <ClipboardList className="mr-1.5 h-4 w-4" />
              Encuestas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="jornada" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <CheckInCard />
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

          <TabsContent value="expedientes" className="mt-5">
            <ComingSoon
              title="Expedientes del personal"
              description="Documentos, contratos, altas IMSS, datos fiscales y trazabilidad del expediente de cada colaborador. Lo construimos en la siguiente entrega."
            />
          </TabsContent>

          <TabsContent value="encuestas" className="mt-5">
            <ComingSoon
              title="Encuestas: nómina, clima organizacional y NOM-035"
              description="Aplicación y seguimiento de encuestas de nómina, clima organizacional y la evaluación de factores de riesgo psicosocial (NOM-035-STPS), con resultados por equipo. Próxima entrega."
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default RecursosHumanos;
