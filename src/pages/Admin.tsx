import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useOrgSettings, useUpdateOrgSettings } from "@/hooks/useOrgSettings";
import { useUserRole } from "@/hooks/useUserRole";
import { Shield } from "lucide-react";

const tabs = [
  { key: "usuarios", label: "Kawiilers" },
  { key: "celulas", label: "Células" },
  { key: "catalogos", label: "Catálogos" },
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
        <div>
          <h1 className="text-xl font-semibold text-foreground">Administración</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestión de Kawiilers, grados y catálogos</p>
        </div>

        <div className="flex gap-1.5">
          {tabs.map((t) => {
            if (t.key === "permisos" && !isTransformador) return null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-pill ${tab === t.key ? "tab-pill-active" : "tab-pill-inactive"}`}
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
          {tab === "permisos" && <PermissionsTab />}
        </div>
      </div>
    </AppLayout>
  );
};

export default Admin;
