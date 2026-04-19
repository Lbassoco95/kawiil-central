import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
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
import {
  formatTimeInZone,
  TIMEZONE_PRESETS,
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

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {zones.map((z) => (
        <TimezoneChip key={z.zone} entry={z} now={now} onRemove={() => remove(z.zone)} />
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
        <PopoverContent align="start" sideOffset={8} className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Buscar zona…" className="h-9" />
            <CommandList>
              <CommandEmpty>Sin coincidencias.</CommandEmpty>
              <CommandGroup>
                {TIMEZONE_PRESETS.filter((p) => !zones.some((z) => z.zone === p.zone)).map((p) => (
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
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
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
    <span className="kw-sb-tz-chip group relative pr-1.5">
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
