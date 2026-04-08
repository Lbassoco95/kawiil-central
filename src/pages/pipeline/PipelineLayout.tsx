import { NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";

const tabs = [
  { to: "/pipeline", label: "Tablero", end: true },
  { to: "/pipeline/list", label: "Lista" },
  { to: "/pipeline/analytics", label: "Métricas" },
  { to: "/pipeline/activities", label: "Actividades" },
  { to: "/pipeline/templates", label: "Plantillas" },
  { to: "/pipeline/sequences", label: "Secuencias" },
  { to: "/pipeline/settings", label: "Ajustes" },
];

export default function PipelineLayout() {
  const loc = useLocation();
  const hideTabs = /^\/pipeline\/leads\//.test(loc.pathname);
  const [searchParams, setSearchParams] = useSearchParams();
  const pipelineQ = searchParams.get("q") ?? "";

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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline y leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Embudo comercial, seguimiento y correos automatizados.
          </p>
        </div>
        {!hideTabs && (
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={pipelineQ}
              onChange={(e) => setPipelineQ(e.target.value)}
              placeholder="Buscar por nombre del contacto o empresa…"
              className="pl-9 pr-10"
              aria-label="Buscar leads"
            />
            {pipelineQ ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 shrink-0"
                onClick={() => setPipelineQ("")}
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground mt-1.5">
              Filtra el tablero y la lista por nombre del contacto, empresa, email o campaña.
            </p>
          </div>
        )}
        {!hideTabs && (
          <nav className="flex flex-wrap gap-1 border-b border-border/60 pb-2">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-1.5 text-sm rounded-md transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}
        <Outlet />
      </div>
    </AppLayout>
  );
}
