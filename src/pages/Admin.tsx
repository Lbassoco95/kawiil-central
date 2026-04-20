import { AppLayout } from "@/components/AppLayout";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";
import { AdoptionAnalyticsTab } from "@/components/admin/AdoptionAnalyticsTab";
import { useEffect, useRef, useState } from "react";
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
  Settings,
  Eye,
  Check,
  RotateCcw,
} from "lucide-react";
import {
  useAccessibility,
  type CvdMode,
} from "@/contexts/AccessibilityContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { MoffinIntegrationCard } from "@/components/admin/MoffinIntegrationCard";
import { AdminKawiilCard } from "@/components/admin/AdminKawiilCard";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";

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

type CvdOption = {
  key: CvdMode;
  label: string;
  description: string;
  swatches: [string, string, string];
};

const CVD_OPTIONS: CvdOption[] = [
  {
    key: "off",
    label: "Desactivado",
    description: "Paleta estándar de Kawiil OS.",
    swatches: ["hsl(0 72% 51%)", "hsl(38 92% 50%)", "hsl(157 72% 36%)"],
  },
  {
    key: "deuteranopia",
    label: "Deuteranopía",
    description: "Rojo-verde (tipo más común). Cambia verdes por azul.",
    swatches: ["hsl(15 85% 50%)", "hsl(48 95% 55%)", "hsl(200 80% 50%)"],
  },
  {
    key: "protanopia",
    label: "Protanopía",
    description: "Rojo-verde con rojos más apagados. Refuerza naranjas.",
    swatches: ["hsl(20 80% 45%)", "hsl(48 95% 55%)", "hsl(200 80% 50%)"],
  },
  {
    key: "tritanopia",
    label: "Tritanopía",
    description: "Azul-amarillo (poco común). Usa magenta y verde.",
    swatches: ["hsl(0 85% 50%)", "hsl(320 75% 55%)", "hsl(140 70% 40%)"],
  },
];

const Configuracion = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as TabKey | null;
  const initial: TabKey = urlTab && VALID.includes(urlTab) ? urlTab : "usuarios";
  const [tab, setTabState] = useState<TabKey>(initial);
  const { isTransformador } = useUserRole();
  const { theme, setTheme } = useTheme();
  const { cvdMode, setCvdMode } = useAccessibility();

  const [pendingCvdMode, setPendingCvdMode] = useState<CvdMode>(cvdMode);
  const pendingRef = useRef<CvdMode>(cvdMode);
  const savedRef = useRef<CvdMode>(cvdMode);

  useEffect(() => {
    savedRef.current = cvdMode;
    setPendingCvdMode(cvdMode);
    pendingRef.current = cvdMode;
  }, [cvdMode]);

  const applyCvdToDom = (mode: CvdMode) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (mode === "off") {
      delete root.dataset.cvd;
    } else {
      root.dataset.cvd = mode;
    }
  };

  const handleSelectPreview = (mode: CvdMode) => {
    setPendingCvdMode(mode);
    pendingRef.current = mode;
    applyCvdToDom(mode);
  };

  const handleSaveCvd = () => {
    setCvdMode(pendingCvdMode);
  };

  const handleDiscardCvd = () => {
    setPendingCvdMode(cvdMode);
    pendingRef.current = cvdMode;
    applyCvdToDom(cvdMode);
  };

  useEffect(() => {
    return () => {
      if (pendingRef.current !== savedRef.current) {
        applyCvdToDom(savedRef.current);
      }
    };
  }, []);

  const cvdDirty = pendingCvdMode !== cvdMode;

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
          {tab === "celulas" && <CelulaManagement />}
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
          {tab === "apariencia" && (
            <div className="space-y-4">
              <section className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40">
                <header
                  className="flex items-center gap-3 px-4 py-2.5 text-white"
                  style={{ background: KAWIIL_AI_HEADER_BG }}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur">
                    <Palette className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold leading-tight">
                      Apariencia · v2.4
                    </p>
                    <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80">
                      Tema claro/oscuro y modo accesible para daltonismo
                    </p>
                  </div>
                </header>
                <div className="space-y-4 bg-card/60 px-4 py-4">
                  <div>
                    <h3 className="text-sm font-semibold">Tema</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Elige el modo claro u oscuro para toda la aplicación.
                    </p>
                    <div className="mt-3 inline-flex rounded-full border border-border/50 bg-background/60 p-1">
                      <button
                        type="button"
                        onClick={() => setTheme("light")}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          (theme ?? "light") === "light"
                            ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Sun className="h-3.5 w-3.5" />
                        Claro
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme("dark")}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          theme === "dark"
                            ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Moon className="h-3.5 w-3.5" />
                        Oscuro
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-border/50 pt-4">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">
                        Visión / Daltonismo
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Selecciona un perfil para previsualizarlo en vivo y luego
                      pulsa <span className="font-medium text-foreground">Guardar</span>{" "}
                      para hacerlo permanente en este dispositivo. Se combina
                      con el modo claro u oscuro.
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="Modo daltónico"
                      className="mt-3 grid gap-2 sm:grid-cols-2"
                    >
                      {CVD_OPTIONS.map((opt) => {
                        const active = pendingCvdMode === opt.key;
                        const isSaved = cvdMode === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => handleSelectPreview(opt.key)}
                            className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                              active
                                ? "border-sky-500/60 bg-sky-50/70 ring-1 ring-sky-500/40 dark:bg-sky-900/20"
                                : "border-border/60 bg-background/40 hover:border-border hover:bg-background/60"
                            }`}
                          >
                            <div className="mt-0.5 flex flex-col gap-1">
                              {opt.swatches.map((color, i) => (
                                <span
                                  key={i}
                                  className="h-2.5 w-2.5 rounded-full ring-1 ring-border/40"
                                  style={{ background: color }}
                                  aria-hidden="true"
                                />
                              ))}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p
                                  className={`text-xs font-semibold ${
                                    active
                                      ? "text-foreground"
                                      : "text-foreground/90"
                                  }`}
                                >
                                  {opt.label}
                                </p>
                                {isSaved && (
                                  <span className="inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                    Actual
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                                {opt.description}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Vista previa en vivo
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Así se ven los colores semánticos con el perfil activo (
                        <span className="font-medium text-foreground">
                          {CVD_OPTIONS.find((o) => o.key === cvdMode)?.label ??
                            "Desactivado"}
                        </span>
                        ).
                      </p>
                      <div className="mt-3 space-y-3">
                        <div>
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Prioridades
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                              style={{ background: "hsl(var(--priority-urgent))" }}
                            >
                              P1 · Urgente
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                              style={{ background: "hsl(var(--priority-high))" }}
                            >
                              P2 · Alta
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-foreground"
                              style={{
                                background: "hsl(var(--priority-medium))",
                              }}
                            >
                              P3 · Media
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                              style={{ background: "hsl(var(--priority-low))" }}
                            >
                              P4 · Baja
                            </span>
                          </div>
                        </div>
                        <div>
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Estados
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-0.5 text-[11px] font-semibold text-success-foreground">
                              Éxito
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2.5 py-0.5 text-[11px] font-semibold text-warning-foreground">
                              Advertencia
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-semibold text-destructive-foreground">
                              Error
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                              style={{ background: "hsl(var(--info))" }}
                            >
                              Info
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                      {cvdDirty ? (
                        <>
                          <button
                            type="button"
                            onClick={handleSaveCvd}
                            className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Guardar cambios
                          </button>
                          <button
                            type="button"
                            onClick={handleDiscardCvd}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Descartar
                          </button>
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">
                            Previsualizando{" "}
                            <span className="font-semibold">
                              {CVD_OPTIONS.find(
                                (o) => o.key === pendingCvdMode,
                              )?.label}
                            </span>{" "}
                            — aún no guardado
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {CVD_OPTIONS.find((o) => o.key === cvdMode)?.label}
                          </span>{" "}
                          guardado en este dispositivo. Cambia un perfil para
                          previsualizar.
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Los gráficos financieros mantienen su paleta por ahora
                      (se ajustarán en una próxima iteración).
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracion;
