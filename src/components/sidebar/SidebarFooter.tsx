import { useEffect, useState } from "react";
import {
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  LogOut,
  MapPin,
  Moon,
  RefreshCw,
  Sun as SunIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useWeather } from "@/hooks/useWeather";
import { useCurrentProfile, getInitials } from "@/hooks/useCurrentProfile";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "./ThemeToggle";
import { TimezoneChips } from "./TimezoneChips";
import { cn } from "@/lib/utils";

interface SidebarFooterProps {
  collapsed: boolean;
}

function weatherIcon(code: number, isDay: boolean) {
  if (code >= 95) return CloudLightning;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80) return CloudRain;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 1 && code <= 3) return CloudSun;
  return isDay ? SunIcon : Moon;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const { signOut, user } = useAuth();
  const { data: profile } = useCurrentProfile();
  const { data: weather, isLoading: weatherLoading, refetch: refetchWeather } = useWeather();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const initials = getInitials(profile, user?.email);
  const Icon = weatherIcon(weather?.code ?? 0, weather?.isDay ?? true);

  const dateLabel = now.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = now.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          "flex-shrink-0 border-t",
          collapsed ? "px-1.5 py-2" : "px-2.5 py-3",
        )}
        style={{ borderColor: "var(--sb-border)", background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.15))" }}
      >
        {/* Weather */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn("kw-sb-weather", collapsed && "grid-cols-1 p-2 justify-items-center")}
              role="status"
              aria-label={weather ? `${weather.temp}° en ${weather.city}` : "Clima"}
            >
              <span
                className="grid place-items-center text-amber-300"
                style={{ width: collapsed ? 24 : 34, height: collapsed ? 24 : 34 }}
              >
                <Icon className={collapsed ? "h-5 w-5" : "h-6 w-6"} />
              </span>
              {!collapsed && (
                <div className="min-w-0">
                  <div
                    className="text-lg font-bold leading-none tabular-nums tracking-tight"
                    style={{ color: "var(--sb-fg)" }}
                  >
                    {weatherLoading || !weather ? "—" : weather.temp}
                    <span className="ml-0.5 text-[11px] font-medium" style={{ color: "var(--sb-fg-dim)" }}>
                      °C
                    </span>
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--sb-fg-dim)" }}>
                    {weather?.condition ?? (weatherLoading ? "Cargando…" : "Sin datos")}
                  </div>
                  <div
                    className="mt-0.5 flex items-center gap-1 text-[10px]"
                    style={{ color: "var(--sb-fg-faint)" }}
                  >
                    <MapPin className="h-2.5 w-2.5" />
                    {weather?.city ?? ""}
                  </div>
                </div>
              )}
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => refetchWeather()}
                  className="kw-sb-iconbtn"
                  style={{ width: 22, height: 22, border: 0, background: "transparent" }}
                  aria-label="Actualizar clima"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
            </div>
          </TooltipTrigger>
          {collapsed && weather && (
            <TooltipContent side="right">
              <span className="font-medium">
                {weather.temp}°C — {weather.condition}
              </span>
              <br />
              <span className="text-xs text-muted-foreground">{weather.city}</span>
            </TooltipContent>
          )}
        </Tooltip>

        {/* Clock */}
        <div
          className={cn(
            "mt-2 flex items-baseline justify-between tabular-nums",
            collapsed ? "justify-center px-0" : "px-1",
          )}
        >
          <span
            className={cn("font-bold tracking-tight", collapsed ? "text-[13px]" : "text-[22px]")}
            style={{ color: "var(--sb-fg)" }}
          >
            {timeLabel}
          </span>
          {!collapsed && (
            <span className="text-[10.5px] capitalize" style={{ color: "var(--sb-fg-dim)" }}>
              {dateLabel}
            </span>
          )}
        </div>

        {/* Timezones */}
        {!collapsed && <TimezoneChips className="mt-2" />}

        {/* Foot actions: user + theme + logout */}
        <div
          className={cn(
            "mt-3 grid items-center gap-1.5 border-t pt-2",
            collapsed ? "grid-cols-1" : "grid-cols-[1fr_auto_auto]",
          )}
          style={{ borderColor: "var(--sb-border)" }}
        >
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1",
              collapsed && "justify-center",
            )}
          >
            <div
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
              style={{
                background: "linear-gradient(135deg, hsl(260 70% 60%), hsl(210 80% 55%))",
                boxShadow: "0 0 0 2px var(--sb-bg)",
              }}
            >
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div
                  className="truncate text-[12px] font-semibold"
                  style={{ color: "var(--sb-fg)" }}
                >
                  {profile?.full_name || user?.email || "Kawiiler"}
                </div>
                {profile?.area && (
                  <div className="truncate text-[10px]" style={{ color: "var(--sb-fg-dim)" }}>
                    {profile.area}
                  </div>
                )}
              </div>
            )}
          </div>

          <ThemeToggle />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => signOut()}
                className="kw-sb-iconbtn"
                aria-label="Cerrar sesión"
              >
                <LogOut className="h-[15px] w-[15px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Cerrar sesión</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
