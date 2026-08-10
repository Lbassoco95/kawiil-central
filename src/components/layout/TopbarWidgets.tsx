import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
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
  TIMEZONE_COUNTRIES,
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
  CommandSeparator,
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

const TZ_POPULAR_CODES = ["CDMX", "MTY", "GDL", "NY", "LA", "MAD", "LON", "TYO"];

function findCityByCode(code: string): TimezoneEntry | undefined {
  for (const c of TIMEZONE_COUNTRIES) {
    const hit = c.cities.find((x) => x.code === code);
    if (hit) return hit;
  }
  return undefined;
}

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const COUNTRY_ALIASES: Record<string, string> = {
  Rusia: "Russia",
  México: "Mexico",
  "Estados Unidos": "USA United States America",
  "Reino Unido": "UK United Kingdom England Britain",
  Alemania: "Germany Deutschland",
  Italia: "Italy",
  España: "Spain",
  Francia: "France",
  Brasil: "Brazil",
  Japón: "Japan",
  Corea: "Korea",
  "Corea del Sur": "South Korea",
  Suecia: "Sweden",
  Noruega: "Norway",
  Dinamarca: "Denmark",
  "Países Bajos": "Netherlands Holland",
  Bélgica: "Belgium",
  Suiza: "Switzerland",
  Polonia: "Poland",
  Grecia: "Greece",
  Turquía: "Turkey",
  Egipto: "Egypt",
  Sudáfrica: "South Africa",
  Marruecos: "Morocco",
  Tailandia: "Thailand",
  Filipinas: "Philippines",
  Indonesia: "Bali Jakarta",
  Singapur: "Singapore",
  "Hong Kong": "HK",
  China: "PRC",
  India: "Bharat",
};

function countrySearchValue(c: { country: string; cities: TimezoneEntry[] }) {
  const cityTokens = c.cities
    .map((x) => `${x.code} ${x.city ?? ""}`)
    .join(" ");
  const alias = COUNTRY_ALIASES[c.country] ?? "";
  const raw = `${c.country} ${cityTokens} ${alias}`;
  return `${raw} ${stripAccents(raw)}`;
}

function cityItemValue(entry: TimezoneEntry) {
  const raw = `${entry.code} ${entry.city ?? ""} ${entry.country ?? ""} ${entry.zone}`;
  return `${raw} ${stripAccents(raw)}`;
}

function TimezoneStrip() {
  const { zones, add, remove } = useTimezones();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [activeCountry, setActiveCountry] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) setActiveCountry(null);
  }, [open]);

  const selectedCodes = useMemo(() => new Set(zones.map((z) => z.code)), [zones]);
  const countryEntry = activeCountry
    ? TIMEZONE_COUNTRIES.find((c) => c.country === activeCountry) ?? null
    : null;

  return (
    <div className="kw-tb-tz">
      <div className="kw-tb-tz-list">
        {zones.map((z) => (
          <TzChip key={z.code} entry={z} now={now} onRemove={() => remove(z.code)} />
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
        <PopoverContent align="end" sideOffset={8} className="w-72 p-0">
          {countryEntry ? (
            <Command>
              <div className="flex items-center gap-1 border-b px-1 py-1">
                <button
                  type="button"
                  onClick={() => setActiveCountry(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  aria-label="Volver a países"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-base">{countryEntry.flag}</span>
                <span className="text-sm font-medium">{countryEntry.country}</span>
              </div>
              <CommandInput placeholder={`Buscar ciudad en ${countryEntry.country}…`} className="h-9" />
              <CommandList>
                <CommandEmpty>Sin coincidencias.</CommandEmpty>
                <CommandGroup heading="Ciudades">
                  {countryEntry.cities
                    .filter((c) => !selectedCodes.has(c.code))
                    .map((c) => (
                      <TzCityItem
                        key={c.code}
                        entry={c}
                        now={now}
                        onSelect={() => {
                          add(c);
                          setOpen(false);
                        }}
                      />
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          ) : (
            <Command>
              <CommandInput placeholder="Buscar país o ciudad…" className="h-9" />
              <CommandList>
                <CommandEmpty>Sin coincidencias.</CommandEmpty>
                <CommandGroup heading="Países">
                  {TIMEZONE_COUNTRIES.map((c) => (
                    <CommandItem
                      key={c.country}
                      value={countrySearchValue(c)}
                      onSelect={() => setActiveCountry(c.country)}
                    >
                      <span className="mr-2 text-base leading-none">{c.flag}</span>
                      <span className="font-medium">{c.country}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {c.cities.length} ciudades
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Ciudades populares">
                  {TZ_POPULAR_CODES.map((code) => {
                    const city = findCityByCode(code);
                    if (!city || selectedCodes.has(city.code)) return null;
                    return (
                      <TzCityItem
                        key={city.code}
                        entry={city}
                        now={now}
                        onSelect={() => {
                          add(city);
                          setOpen(false);
                        }}
                      />
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TzCityItem({
  entry,
  now,
  onSelect,
}: {
  entry: TimezoneEntry;
  now: Date;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={cityItemValue(entry)}
      onSelect={onSelect}
    >
      <span className="mr-2 text-base leading-none">{entry.flag}</span>
      <span className="font-medium">{entry.city ?? entry.code}</span>
      <span className="ml-2 text-[10px] uppercase text-muted-foreground">{entry.code}</span>
      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
        {formatTimeInZone(now, entry.zone)}
      </span>
    </CommandItem>
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
      <div className={cn("hidden lg:flex items-center gap-3", className)}>
        <WeatherPill />
        <PrimaryClock />
        <div className="hidden xl:block">
          <TimezoneStrip />
        </div>
      </div>
    </TooltipProvider>
  );
}
