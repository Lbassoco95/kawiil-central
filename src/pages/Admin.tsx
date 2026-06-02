import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { DefaultAbsenceApproverCard } from "@/components/admin/DefaultAbsenceApproverCard";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { AdoptionAnalyticsTab } from "@/components/admin/AdoptionAnalyticsTab";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import {
  Plug,
  Users,
  Network,
  ListTree,
  TrendingUp,
  Palette,
  Settings,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { MoffinIntegrationCard } from "@/components/admin/MoffinIntegrationCard";
import { AdminKawiilCard } from "@/components/admin/AdminKawiilCard";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import { AppearanceAccessibilityPanel } from "@/components/preferences/AppearanceAccessibilityPanel";

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
          variant="hero"
          breadcrumb={["Kawiil OS", "Sistema", "Configuración"]}
          icon={<Settings />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Configuración"
          description="Gestión de Kawiilers, células, catálogos, integraciones y apariencia"
          actions={
            <Badge
              variant="outline"
              className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
            >
              v2.4
            </Badge>
          }
        />

        <AdminKawiilCard
          activeTab={tab}
          onGoToTab={(t) => setTab(t)}
          isTransformador={isTransformador}
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
          {tab === "celulas" && (
            <div className="space-y-4">
              <CelulaManagement />
              {isTransformador && <DefaultAbsenceApproverCard />}
            </div>
          )}
          {tab === "catalogos" && <CatalogManagement />}
          {tab === "adopcion" && <AdoptionAnalyticsTab />}
          {tab === "integraciones" && isTransformador && (
            <div className="space-y-4">
              <section className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40">
                <header
                  className="flex items-center gap-3 px-4 py-2.5 text-white"
                  style={{ background: KAWIIL_AI_HEADER_BG }}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur">
                    <Plug className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold leading-tight">
                      Integraciones externas
                    </p>
                    <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80">
                      Configuración solo visible para transformadores
                    </p>
                  </div>
                </header>
                <div className="space-y-3 bg-card/60 px-4 py-4">
                  <p className="text-xs text-muted-foreground">
                    Conecta servicios externos como Moffin (SAT), Microsoft 365, Slack o
                    Dropbox. Cada integración expone su propio panel de salud y
                    credenciales.
                  </p>
                  <MoffinIntegrationCard />
                </div>
              </section>
            </div>
          )}
          {tab === "apariencia" && <AppearanceAccessibilityPanel />}
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracion;
