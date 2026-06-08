import { AppLayout } from "@/components/AppLayout";
import { RecursosHumanosPanel } from "@/components/rh/RecursosHumanosPanel";

/**
 * Página dedicada de Recursos Humanos (jornada, expediente, reclutamiento,
 * cuestionarios, tablero CHRO…). El panel lee la sub-pestaña de `?rh=`.
 * También sigue accesible como pestaña dentro del Hub.
 */
export default function RecursosHumanos() {
  return (
    <AppLayout>
      <RecursosHumanosPanel />
    </AppLayout>
  );
}
