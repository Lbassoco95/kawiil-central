import { NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, X, Filter } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import { useAllTasks } from "@/hooks/usePipeline";

const tabs: Array<{ to: string; label: string; end?: boolean; counterKey?: "overdue" }> = [
  { to: "/pipeline/dashboard", label: "Dashboard" },
  { to: "/pipeline", label: "Tablero", end: true },
  { to: "/pipeline/list", label: "Lista" },
  { to: "/pipeline/activities", label: "Actividades", counterKey: "overdue" },
  { to: "/pipeline/sequences", label: "Secuencias" },
  { to: "/pipeline/partners", label: "Partners" },
  { to: "/pipeline/templates", label: "Plantillas" },
  { to: "/pipeline/settings", label: "Ajustes" },
];

export default function PipelineLayout() {
  const loc = useLocation();
  const hideTabs = /^\/pipeline\/leads\//.test(loc.pathname);
  // En el Dashboard el hero ejecutivo "Sala de control comercial" ya cumple el rol del header,
  // así que ocultamos el header genérico para evitar dos cabeceras compitiendo visualmente.
  const isDashboard = loc.pathname === "/pipeline/dashboard";
  const [searchParams, setSearchParams] = useSearchParams();
  const pipelineQ = searchParams.get("q") ?? "";
  const { data: overdueTasks = [] } = useAllTasks("overdue");
  const overdueCount = overdueTasks.length;

  const setPipelineQ = (value: string) => {
    const next = new URLSearchParams(searchParams);
    const v = value.trim();
    if (v) next.set("q", v);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6 max-w-[1600px] mx-auto w-full">
        {!isDashboard && (
          <PageHeader
            variant="hero"
            breadcrumb={["Kawiil OS", "Comercial", "Pipeline"]}
            icon={<Filter />}
            iconAccent={KAWIIL_AI_GRADIENT}
            title="Pipeline y leads"
            description="Embudo comercial, seguimiento y correos automatizados."
            actions={
              <Badge
                variant="outline"
                className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
            }
          />
        )}
        {!hideTabs && !isDashboard && (
          <div className="surface-toolbar max-w-xl space-y-1.5 rounded-xl p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={pipelineQ}
                onChange={(e) => setPipelineQ(e.target.value)}
                placeholder="Buscar por nombre del contacto o empresa…"
                className="border-border/50 bg-background/60 pl-9 pr-10"
                aria-label="Buscar leads"
              />
              {pipelineQ ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 shrink-0 -translate-y-1/2"
                  onClick={() => setPipelineQ("")}
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground pl-0.5">
              Filtra el tablero y la lista por nombre del contacto, empresa, email o campaña.
            </p>
          </div>
        )}
        {!hideTabs && (
          <nav className="surface-toolbar flex flex-wrap gap-1 p-2">
            {tabs.map((t) => {
              const count = t.counterKey === "overdue" ? overdueCount : 0;
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    cn(
                      "px-3 py-1.5 text-sm rounded-lg transition-colors inline-flex items-center gap-1.5",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }: { isActive: boolean }) => (
                    <>
                      <span>{t.label}</span>
                      {count > 0 ? (
                        <span
                          className={cn(
                            "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-[18px]",
                            isActive
                              ? "bg-white/25 text-white"
                              : "bg-destructive text-destructive-foreground",
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        )}
        <Outlet />
      </div>
    </AppLayout>
  );
}
