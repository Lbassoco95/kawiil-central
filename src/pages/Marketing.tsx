import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Megaphone } from "lucide-react";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { useCalibracion, useCasos, useCobertura, usePiezas, useReglaHistorial, useReglas } from "@/hooks/useMarketing";
import { PanelDia } from "@/components/marketing/PanelDia";
import { Calendario } from "@/components/marketing/Calendario";
import { Casos } from "@/components/marketing/Casos";
import { Semaforo } from "@/components/marketing/Semaforo";
import { Reglas } from "@/components/marketing/Reglas";

// Marketing · monitoreo (primera versión, solo lectura). No escribe en la base ni llama a Metricool.
export default function Marketing() {
  const { hasModuleStrict } = useModulePermissions();
  const puedeDecidir = hasModuleStrict("marketing_decidir");
  const piezas = usePiezas();
  const calibracion = useCalibracion();
  const casos = useCasos();
  const reglas = useReglas();
  const historial = useReglaHistorial();
  const cobertura = useCobertura();

  const cargando = [piezas, calibracion, casos, reglas, historial, cobertura].some((q) => q.isLoading);
  const error = [piezas, calibracion, casos, reglas, historial, cobertura].find((q) => q.isError);

  return (
    <AppLayout>
      <div className="zen-page zen-dash mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="Marketing"
          description="Monitoreo de campañas · primera versión de solo lectura"
          icon={<Megaphone className="h-5 w-5" />}
          className="zen-hero zen-glass"
        />
        {error ? (
          <p className="zen-glass rounded-2xl p-6 text-sm">No pudimos cargar los datos de Marketing. Revisa que tu usuario tenga el permiso de Marketing e inténtalo de nuevo.</p>
        ) : cargando ? (
          <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
        ) : (
          <Tabs defaultValue="panel">
            <TabsList className="flex-wrap">
              <TabsTrigger value="panel">Panel del día</TabsTrigger>
              <TabsTrigger value="calendario">Calendario</TabsTrigger>
              <TabsTrigger value="casos">Casos</TabsTrigger>
              <TabsTrigger value="semaforo">Semáforo</TabsTrigger>
              <TabsTrigger value="reglas">Reglas</TabsTrigger>
            </TabsList>
            <TabsContent value="panel" className="mt-4">
              <PanelDia calibracion={calibracion.data!} piezas={piezas.data!} casos={casos.data!} cobertura={cobertura.data!} />
            </TabsContent>
            <TabsContent value="calendario" className="mt-4"><Calendario piezas={piezas.data!} /></TabsContent>
            <TabsContent value="casos" className="mt-4"><Casos casos={casos.data!} puedeDecidir={puedeDecidir} /></TabsContent>
            <TabsContent value="semaforo" className="mt-4"><Semaforo calibracion={calibracion.data!} /></TabsContent>
            <TabsContent value="reglas" className="mt-4"><Reglas reglas={reglas.data!} historial={historial.data!} puedeDecidir={puedeDecidir} /></TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
