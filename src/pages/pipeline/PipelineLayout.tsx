import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { cn } from "@/lib/utils";

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
