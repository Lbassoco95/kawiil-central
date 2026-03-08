import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { useState } from "react";

const tabs = [
  { key: "usuarios", label: "Kawiilers" },
  { key: "celulas", label: "Células" },
  { key: "catalogos", label: "Catálogos" },
] as const;

const Admin = () => {
  const [tab, setTab] = useState<string>("usuarios");

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Administración</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestión de Kawiilers, grados y catálogos</p>
        </div>

        <div className="flex gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "usuarios" && <UserManagement />}
        {tab === "celulas" && <CelulaManagement />}
        {tab === "catalogos" && <CatalogManagement />}
      </div>
    </AppLayout>
  );
};

export default Admin;
