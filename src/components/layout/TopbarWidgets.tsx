import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  DollarSign,
  MapPin,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  Sun as SunIcon,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useWeather } from "@/hooks/useWeather";
import {
  ExchangeRateError,
  formatFxDate,
  formatFxValue,
  isToday,
  useExchangeRate,
} from "@/hooks/useExchangeRate";
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

function FxTrendIcon({ cambio }: { cambio: number | null }) {
  if (cambio === null || cambio === 0) return <Minus className="h-3 w-3" />;
  return cambio > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />;
}

/**
 * Tipo de cambio oficial de Banxico (serie SF60653: para solventar obligaciones
 * denominadas en moneda extranjera, la que se publica en el DOF). Al hacer clic
 * muestra la variación contra la publicación anterior y el FIX como referencia.
 */
function FxPill() {
  const { data, isLoading, error, refetch, isFetching } = useExchangeRate();
  const [open, setOpen] = useState(false);
  const fx = data?.obligaciones;
  const notConfigured =
    error instanceof ExchangeRateError &&
    (error.code === "banxico_not_configured" || error.code === "not_deployed");

  const valueLabel = fx ? formatFxValue(fx.valor) : isLoading ? "—" : "n/d";
  const trendClass =
    fx?.cambio == null || fx.cambio === 0
      ? "kw-tb-fx-flat"
      : fx.cambio > 0
        ? "kw-tb-fx-up"
        : "kw-tb-fx-down";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kw-tb-fx"
          aria-label={
            fx
              ? `Tipo de cambio para solventar obligaciones: ${valueLabel} pesos por dólar, publicado el ${formatFxDate(fx.fecha, true)}`
              : "Tipo de cambio Banxico"
          }
        >
          <span className="kw-tb-fx-ico">
            <DollarSign className="h-5 w-5" />
          </span>
          <span className="kw-tb-fx-body min-w-0">
            <span className="kw-tb-fx-value tabular-nums">
              {valueLabel}
              <span className="kw-tb-fx-unit">MXN/USD</span>
            </span>
            <span className="kw-tb-fx-label truncate">
              {notConfigured ? "Sin configurar" : "Solventar obligaciones"}
            </span>
            {fx && (
              <span className="kw-tb-fx-meta hidden 2xl:flex">
                <span className={cn("kw-tb-fx-trend", trendClass)}>
                  <FxTrendIcon cambio={fx.cambio} />
                  {fx.cambioPct !== null
                    ? `${fx.cambioPct > 0 ? "+" : ""}${fx.cambioPct.toFixed(2)}%`
                    : "—"}
                </span>
                <span className="kw-tb-fx-date">
                  {isToday(fx.fecha) ? "hoy" : formatFxDate(fx.fecha)}
                </span>
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold leading-tight">Tipo de cambio Banxico</div>
            <div className="text-[11px] text-muted-foreground">
              Pesos por dólar de E.U.A.
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="kw-tb-weather-refresh"
            aria-label="Actualizar tipo de cambio"
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </button>
        </div>

        {fx ? (
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Para solventar obligaciones (DOF)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tabular-nums">{formatFxValue(fx.valor)}</span>
                <span className={cn("kw-tb-fx-trend", trendClass)}>
                  <FxTrendIcon cambio={fx.cambio} />
                  {fx.cambio !== null
                    ? `${fx.cambio > 0 ? "+" : ""}${fx.cambio.toFixed(4)}`
                    : "—"}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Publicado el {formatFxDate(fx.fecha, true)}
                {fx.fechaPrevia && ` · anterior ${formatFxValue(fx.valorPrevio ?? 0)} (${formatFxDate(fx.fechaPrevia)})`}
              </div>
            </div>

            {data?.fix && (
              <div className="border-t border-border/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    FIX (referencia)
                  </span>
                  <span className="font-medium tabular-nums">{formatFxValue(data.fix.valor)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Publicado el {formatFxDate(data.fix.fecha, true)}
                </div>
              </div>
            )}

            <div className="text-[10px] leading-snug text-muted-foreground">
              Fuente: Banxico, serie {fx.idSerie}. Banxico publica un solo dato por día
              hábil; el de hoy aparece alrededor del mediodía.
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-[12px] text-muted-foreground">
            {isLoading ? (
              <p>Consultando Banxico…</p>
            ) : notConfigured ? (
              <>
                <p>
                  Falta el token de Banxico en el servidor. Genera uno gratis en
                  banxico.org.mx y guárdalo como secret{" "}
                  <code className="rounded bg-muted px-1">BANXICO_TOKEN</code> del proyecto
                  de Supabase.
                </p>
                <p className="text-[11px]">Ver docs/banxico-tipo-de-cambio.md</p>
              </>
            ) : (
              <p>{error instanceof Error ? error.message : "No se pudo obtener el tipo de cambio."}</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
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
        <FxPill />
        <PrimaryClock />
        <div className="hidden xl:block">
          <TimezoneStrip />
        </div>
      </div>
    </TooltipProvider>
  );
}
