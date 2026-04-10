import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { AdoptionAnalyticsTab } from "@/components/admin/AdoptionAnalyticsTab";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useOrgSettings, useUpdateOrgSettings } from "@/hooks/useOrgSettings";
import { useUserRole } from "@/hooks/useUserRole";
import { Shield, Plug } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MoffinIntegrationCard } from "@/components/admin/MoffinIntegrationCard";

const tabs = [
  { key: "usuarios", label: "Kawiilers" },
  { key: "celulas", label: "Células" },
  { key: "catalogos", label: "Catálogos" },
  { key: "adopcion", label: "Adopción" },
  { key: "integraciones", label: "Integraciones" },
  { key: "permisos", label: "Permisos" },
] as const;

function PermissionsTab() {
  const { settings } = useOrgSettings();
  const updateSettings = useUpdateOrgSettings();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Permisos de Referentes (G3)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Eliminar tareas</Label>
              <p className="text-xs text-muted-foreground">
                Permite a los Kawiilers Referente eliminar tareas de cualquier miembro.
              </p>
            </div>
            <Switch
              checked={!!settings.referente_delete_tasks}
              onCheckedChange={(checked) =>
                updateSettings.mutate({ referente_delete_tasks: checked })
              }
              disabled={updateSettings.isPending}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Modificar fechas límite</Label>
              <p className="text-xs text-muted-foreground">
                Permite a los Kawiilers Referente cambiar la fecha de entrega de cualquier tarea.
              </p>
            </div>
            <Switch
              checked={!!settings.referente_edit_due_dates}
              onCheckedChange={(checked) =>
                updateSettings.mutate({ referente_edit_due_dates: checked })
              }
              disabled={updateSettings.isPending}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
            if (t.key === "permisos" && !isTransformador) return null;
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
          {tab === "permisos" && <PermissionsTab />}
        </div>
      </div>
    </AppLayout>
  );
};

export default Admin;
