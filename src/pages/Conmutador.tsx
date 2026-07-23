import { AppLayout } from "@/components/AppLayout";
import { ConmutadorPanel } from "@/components/conmutador/ConmutadorPanel";

/**
 * Página del Conmutador (telefonía + secretario IA). Gateada por el módulo
 * "conmutador" (ver ModuleGate en App.tsx).
 */
export default function Conmutador() {
  return (
    <AppLayout>
      <ConmutadorPanel />
    </AppLayout>
  );
}
