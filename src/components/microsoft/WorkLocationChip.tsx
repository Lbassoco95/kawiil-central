import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  WORK_STATUS_META, useSetWorkLocation, useClearWorkLocation,
  type WorkStatus, type WorkLocation,
} from "@/hooks/useWorkLocations";
import { MapPin, X } from "lucide-react";

const STATUSES: WorkStatus[] = ["oficina", "remoto", "transito", "en_sitio"];

interface Props {
  date: string; // yyyy-MM-dd
  entry?: WorkLocation;
  compact?: boolean;
}

/** Chip de "dónde estás trabajando" para un día: muestra el estatus y permite fijarlo. */
export function WorkLocationChip({ date, entry, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(entry?.place || "");
  const setWork = useSetWorkLocation();
  const clearWork = useClearWorkLocation();

  useEffect(() => { setPlace(entry?.place || ""); }, [entry?.place]);

  const meta = entry ? WORK_STATUS_META[entry.status] : null;

  const pick = (status: WorkStatus) => {
    if (status === "en_sitio") {
      setWork.mutate({ date, status, place: place.trim() || null });
    } else {
      setWork.mutate({ date, status, place: null });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium transition-colors max-w-full",
            meta ? "border-transparent text-white" : "border-dashed border-border text-muted-foreground hover:bg-accent",
          )}
          style={meta ? { backgroundColor: meta.color } : undefined}
          title={meta ? `${meta.label}${entry?.place ? ` · ${entry.place}` : ""}` : "¿Dónde trabajas hoy?"}
        >
          {meta ? (
            <>
              <span>{meta.icon}</span>
              <span className="truncate">{entry?.place || meta.short}</span>
            </>
          ) : (
            <>
              <MapPin className="h-2.5 w-2.5" />
              {!compact && <span>Ubicación</span>}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">¿Dónde trabajas?</p>
        <div className="grid grid-cols-2 gap-1">
          {STATUSES.map((s) => {
            const m = WORK_STATUS_META[s];
            const activeStatus = entry?.status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => pick(s)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors text-left",
                  activeStatus ? "border-transparent text-white" : "border-border hover:bg-accent",
                )}
                style={activeStatus ? { backgroundColor: m.color } : undefined}
              >
                <span>{m.icon}</span>
                <span className="truncate">{m.short}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-1">
          <Input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setWork.mutate({ date, status: "en_sitio", place: place.trim() || null }); setOpen(false); } }}
            placeholder="Lugar (ej. Dazon)"
            className="h-7 text-xs"
          />
          <button
            type="button"
            onClick={() => { setWork.mutate({ date, status: "en_sitio", place: place.trim() || null }); setOpen(false); }}
            className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            title="Guardar 'En sitio'"
          >
            OK
          </button>
        </div>
        {entry && (
          <button
            type="button"
            onClick={() => { clearWork.mutate(date); setOpen(false); }}
            className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" /> Quitar
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
