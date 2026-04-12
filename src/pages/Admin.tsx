import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { AdoptionAnalyticsTab } from "@/components/admin/AdoptionAnalyticsTab";
import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { Plug } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MoffinIntegrationCard } from "@/components/admin/MoffinIntegrationCard";

const tabs = [
  { key: "usuarios", label: "Kawiilers" },
  { key: "celulas", label: "Células" },
  { key: "catalogos", label: "Catálogos" },
  { key: "adopcion", label: "Adopción" },
  { key: "integraciones", label: "Integraciones" },
] as const;

const Admin = () => {
  const [tab, setTab] = useState<string>("usuarios");
  const { isTransformador } = useUserRole();

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Administración"
          description="Gestión de Kawiilers, grados y catálogos"
        />

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {tabs.map((t) => {
            if (t.key === "integraciones" && !isTransformador) return null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-pill shrink-0 whitespace-nowrap ${tab === t.key ? "tab-pill-active" : "tab-pill-inactive"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="animate-fade-in" key={tab}>
          {tab === "usuarios" && <UserManagement />}
          {tab === "celulas" && <CelulaManagement />}
          {tab === "catalogos" && <CatalogManagement />}
          {tab === "adopcion" && <AdoptionAnalyticsTab />}
          {tab === "integraciones" && isTransformador && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Plug className="h-4 w-4" />
                <span>Estado de integraciones externas (solo transformadores).</span>
              </div>
              <MoffinIntegrationCard />
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Admin;
