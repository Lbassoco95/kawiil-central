import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Plus, X } from "lucide-react";
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
import {
  formatTimeInZone,
  TIMEZONE_COUNTRIES,
  TimezoneEntry,
  useTimezones,
} from "@/hooks/useTimezones";
import { cn } from "@/lib/utils";

interface TimezoneChipsProps {
  className?: string;
}

export function TimezoneChips({ className }: TimezoneChipsProps) {
  const { zones, add, remove } = useTimezones();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [activeCountry, setActiveCountry] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Reset country selection whenever popover closes.
  useEffect(() => {
    if (!open) setActiveCountry(null);
  }, [open]);

  const selectedCodes = useMemo(() => new Set(zones.map((z) => z.code)), [zones]);
  const countryEntry = activeCountry
    ? TIMEZONE_COUNTRIES.find((c) => c.country === activeCountry) ?? null
    : null;

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {zones.map((z) => (
        <TimezoneChip key={z.code} entry={z} now={now} onRemove={() => remove(z.code)} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-[3px] text-[10px] text-[color:var(--sb-fg-faint)] hover:text-[color:var(--sb-fg-dim)]"
            style={{ borderColor: "var(--sb-border)" }}
            aria-label="Agregar zona horaria"
          >
            <Plus className="h-2.5 w-2.5" />
            TZ
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-72 p-0">
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
                      <CityItem
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
                      value={`${c.country} ${c.cities.map((x) => `${x.code} ${x.city}`).join(" ")}`}
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
                  {POPULAR_CODES.map((code) => {
                    const city = findCity(code);
                    if (!city || selectedCodes.has(city.code)) return null;
                    return (
                      <CityItem
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

const POPULAR_CODES = ["CDMX", "MTY", "GDL", "NY", "LA", "MAD", "LON", "TYO"];

function findCity(code: string): TimezoneEntry | undefined {
  for (const c of TIMEZONE_COUNTRIES) {
    const hit = c.cities.find((x) => x.code === code);
    if (hit) return hit;
  }
  return undefined;
}

function CityItem({
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
      value={`${entry.code} ${entry.city ?? ""} ${entry.country ?? ""} ${entry.zone}`}
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

function TimezoneChip({
  entry,
  now,
  onRemove,
}: {
  entry: TimezoneEntry;
  now: Date;
  onRemove: () => void;
}) {
  return (
    <span className="kw-sb-tz-chip group relative pr-1.5" title={`${entry.city ?? entry.code} · ${entry.zone}`}>
      {entry.flag && <span className="text-[10px] leading-none">{entry.flag}</span>}
      <span className="font-semibold text-[color:var(--sb-fg)]">{entry.code}</span>
      <span className="text-[10px] tabular-nums">{formatTimeInZone(now, entry.zone)}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Eliminar ${entry.code}`}
        className="ml-1 hidden h-3 w-3 items-center justify-center rounded-full text-[color:var(--sb-fg-faint)] hover:text-[color:var(--sb-fg)] group-hover:flex"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
