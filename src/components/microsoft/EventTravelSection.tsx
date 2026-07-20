import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Car, Loader2 } from "lucide-react";
import { useTravelTime } from "@/hooks/useTravelTime";
import { formatMX } from "@/lib/dateUtils";

interface Props {
  destination: string;
  departureISO?: string | null;
  defaultOrigin?: string;
}

/** Sección "Trayecto": calcula tiempo con tráfico hasta la ubicación del evento. */
export function EventTravelSection({ destination, departureISO, defaultOrigin }: Props) {
  const [origin, setOrigin] = useState(defaultOrigin || "");
  const travel = useTravelTime();

  const suggestedDeparture = (() => {
    if (!departureISO || !travel.data?.durationSeconds) return null;
    try {
      const leave = new Date(new Date(departureISO).getTime() - travel.data.durationSeconds * 1000);
      return formatMX(leave, "HH:mm");
    } catch { return null; }
  })();

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <Label className="flex items-center gap-1.5"><Car className="h-4 w-4" /> Trayecto</Label>
      <div className="flex items-center gap-2">
        <Input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="Tu punto de salida (dirección o lugar)"
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={!origin.trim() || travel.isPending}
          onClick={() => travel.mutate({ origin: origin.trim(), destination, departureTime: departureISO || undefined })}
        >
          {travel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Calcular"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground truncate">Destino: {destination}</p>
      {travel.isError && (
        <p className="text-[11px] text-destructive">{travel.error instanceof Error ? travel.error.message : "No se pudo calcular"}</p>
      )}
      {travel.data?.noRoute && (
        <p className="text-[11px] text-muted-foreground">{travel.data.message || "No se encontró una ruta en coche entre esos puntos."}</p>
      )}
      {travel.data && !travel.data.noRoute && (
        <div className="text-sm text-foreground">
          🚗 <span className="font-semibold">{travel.data.durationText}</span>
          {travel.data.withTraffic ? " con tráfico" : ""}
          {travel.data.distanceText ? ` · ${travel.data.distanceText}` : ""}
          {travel.data.withTraffic && travel.data.baseDurationText && (
            <span className="block text-[11px] text-muted-foreground mt-0.5">Sin tráfico: {travel.data.baseDurationText}</span>
          )}
          {suggestedDeparture && (
            <span className="block text-[11px] text-muted-foreground mt-0.5">Sal a las <span className="font-medium text-foreground">{suggestedDeparture}</span> para llegar a tiempo.</span>
          )}
        </div>
      )}
    </div>
  );
}
