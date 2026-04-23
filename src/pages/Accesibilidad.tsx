import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Accessibility } from "lucide-react";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import { AppearanceAccessibilityPanel } from "@/components/preferences/AppearanceAccessibilityPanel";

export default function Accesibilidad() {
  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Cuenta", "Accesibilidad"]}
          icon={<Accessibility />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Accesibilidad"
          description="Tema, contraste y paleta para daltonismo. Las preferencias se guardan en este dispositivo."
        />
        <AppearanceAccessibilityPanel />
      </div>
    </AppLayout>
  );
}
