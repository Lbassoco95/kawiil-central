import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { AdoptionAnalyticsTab } from "@/components/admin/AdoptionAnalyticsTab";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { useTheme } from "next-themes";
import {
  Plug,
  Users,
  Network,
  ListTree,
  TrendingUp,
  Palette,
  Sun,
  Moon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MoffinIntegrationCard } from "@/components/admin/MoffinIntegrationCard";

type TabKey =
  | "usuarios"
  | "celulas"
  | "catalogos"
  | "adopcion"
  | "integraciones"
  | "apariencia";

const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: "usuarios", label: "Kawiilers", icon: Users },
  { key: "celulas", label: "Células", icon: Network },
  { key: "catalogos", label: "Catálogos", icon: ListTree },
  { key: "adopcion", label: "Adopción", icon: TrendingUp },
  { key: "integraciones", label: "Integraciones", icon: Plug },
  { key: "apariencia", label: "Apariencia", icon: Palette },
];

const VALID: TabKey[] = TABS.map((t) => t.key);

const Configuracion = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as TabKey | null;
  const initial: TabKey = urlTab && VALID.includes(urlTab) ? urlTab : "usuarios";
  const [tab, setTabState] = useState<TabKey>(initial);
  const { isTransformador } = useUserRole();
  const { theme, setTheme } = useTheme();

  const setTab = (key: TabKey) => {
    setTabState(key);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", key);
        return p;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    if (urlTab && VALID.includes(urlTab) && urlTab !== tab) {
      setTabState(urlTab);
    }
  }, [urlTab]);

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Configuración"
          description="Gestión de Kawiilers, células, catálogos, integraciones y apariencia"
        />

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {TABS.map((t) => {
            if (t.key === "integraciones" && !isTransformador) return null;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-pill inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
                  tab === t.key ? "tab-pill-active" : "tab-pill-inactive"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
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
          {tab === "apariencia" && (
            <div className="space-y-4">
              <div className="surface-toolbar p-4 sm:p-5">
                <h3 className="text-sm font-semibold">Tema</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Elige el modo claro u oscuro para toda la aplicación.
                </p>
                <div className="mt-4 inline-flex rounded-lg border border-border/50 bg-background/40 p-1">
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    className={`tab-pill inline-flex items-center gap-1.5 ${
                      (theme ?? "light") === "light" ? "tab-pill-active" : "tab-pill-inactive"
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    Claro
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    className={`tab-pill inline-flex items-center gap-1.5 ${
                      theme === "dark" ? "tab-pill-active" : "tab-pill-inactive"
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    Oscuro
                  </button>
                </div>
              </div>
              <div className="surface-toolbar p-4 sm:p-5">
                <h3 className="text-sm font-semibold">Próximamente</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Densidad de tablas, idioma y atajos de teclado personalizados.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracion;
