import { useEffect, useState } from "react";
import {
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  MapPin,
  Moon,
  Plus,
  RefreshCw,
  Sun as SunIcon,
  X,
} from "lucide-react";
import { useWeather } from "@/hooks/useWeather";
import {
  formatTimeInZone,
  TIMEZONE_PRESETS,
  TimezoneEntry,
  useTimezones,
} from "@/hooks/useTimezones";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

function WeatherPill() {
  const { data: weather, isLoading, refetch, isFetching } = useWeather();
  const Icon = weatherIcon(weather?.code ?? 0, weather?.isDay ?? true);

  return (
    <div
      className="kw-tb-weather"
      role="status"
      aria-label={weather ? `${weather.temp}° en ${weather.city}` : "Clima"}
    >
      <span className="kw-tb-weather-ico">
        <Icon className="h-5 w-5" />
      </span>
      <div className="kw-tb-weather-body min-w-0">
        <div className="kw-tb-weather-temp tabular-nums">
          {isLoading || !weather ? "—" : weather.temp}
          <span className="kw-tb-weather-unit">°C</span>
        </div>
        <div className="kw-tb-weather-cond truncate">
          {weather?.condition ?? (isLoading ? "Cargando…" : "Sin datos")}
        </div>
        {weather?.city && (
          <div className="kw-tb-weather-city hidden 2xl:flex">
            <MapPin className="h-2.5 w-2.5" />
            <span className="truncate">{weather.city}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => refetch()}
        className="kw-tb-weather-refresh"
        aria-label="Actualizar clima"
        disabled={isFetching}
      >
        <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
      </button>
    </div>
  );
}

function PrimaryClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeParts = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const time = timeParts
    .filter((p) => p.type !== "dayPeriod" && p.type !== "literal")
    .map((p) => p.value)
    .join(":")
    .replace(/^(\d):/, "0$1:");
  const ampm = (timeParts.find((p) => p.type === "dayPeriod")?.value || "").toUpperCase();
  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  })
    .format(now)
    .replace(/\./g, "");

  return (
    <div className="kw-tb-clock tabular-nums">
      <div className="kw-tb-clock-time">
        {time}
        <span className="kw-tb-clock-ampm">{ampm}</span>
      </div>
      <div className="kw-tb-clock-date hidden xl:block">{dateLabel}</div>
    </div>
  );
}

function TimezoneStrip() {
  const { zones, add, remove } = useTimezones();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="kw-tb-tz">
      <div className="flex flex-col gap-[3px]">
        {zones.slice(0, 3).map((z) => (
          <TzChip key={z.zone} entry={z} now={now} onRemove={() => remove(z.zone)} />
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="kw-tb-tz-add"
            aria-label="Agregar zona horaria"
          >
            <Plus className="h-2.5 w-2.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Buscar zona…" className="h-9" />
            <CommandList>
              <CommandEmpty>Sin coincidencias.</CommandEmpty>
              <CommandGroup>
                {TIMEZONE_PRESETS.filter((p) => !zones.some((z) => z.zone === p.zone)).map(
                  (p) => (
                    <CommandItem
                      key={p.zone}
                      value={`${p.code} ${p.zone}`}
                      onSelect={() => {
                        add(p);
                        setOpen(false);
                      }}
                    >
                      <span className="mr-2">{p.flag}</span>
                      <span className="font-medium">{p.code}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.zone}</span>
                    </CommandItem>
                  ),
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TzChip({
  entry,
  now,
  onRemove,
}: {
  entry: TimezoneEntry;
  now: Date;
  onRemove: () => void;
}) {
  return (
    <span className="kw-tb-tz-chip group">
      {entry.flag && <span className="kw-tb-tz-chip-flag">{entry.flag}</span>}
      <span className="kw-tb-tz-chip-code">{entry.code}</span>
      <span className="kw-tb-tz-chip-time tabular-nums">{formatTimeInZone(now, entry.zone)}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Eliminar ${entry.code}`}
        className="kw-tb-tz-chip-x"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

interface TopbarWidgetsProps {
  className?: string;
}

export function TopbarWidgets({ className }: TopbarWidgetsProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("hidden md:flex items-center gap-3", className)}>
        <WeatherPill />
        <PrimaryClock />
        <div className="hidden xl:block">
          <TimezoneStrip />
        </div>
      </div>
    </TooltipProvider>
  );
}
