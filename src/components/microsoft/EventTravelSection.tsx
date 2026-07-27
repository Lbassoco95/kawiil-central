import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Car, Loader2, Check } from "lucide-react";
import { useTravelTime } from "@/hooks/useTravelTime";
import { useSaveEventTravel } from "@/hooks/useEventTravel";
import { PlaceAutocompleteInput } from "@/components/microsoft/PlaceAutocompleteInput";
import { formatMX } from "@/lib/dateUtils";

interface Props {
  destination: string;
  departureISO?: string | null;
  defaultOrigin?: string;
  /** Si se pasa, al calcular se guarda el trayecto y aparece el bloque en el calendario. */
  eventId?: string | null;
}

/** Sección "Trayecto": calcula tiempo con tráfico hasta la ubicación del evento. */
export function EventTravelSection({ destination, departureISO, defaultOrigin, eventId }: Props) {
  const [origin, setOrigin] = useState(defaultOrigin || "");
  const travel = useTravelTime();
  const saveTravel = useSaveEventTravel();

  // Al obtener un resultado válido con ruta, persistir el trayecto para el bloque
  // de traslado en el calendario (solo eventos existentes con id).
  useEffect(() => {
    if (!eventId || !travel.data || travel.data.noRoute || !travel.data.durationSeconds) return;
    saveTravel.mutate({
      event_id: eventId,
      origin: origin.trim(),
      destination,
      duration_seconds: travel.data.durationSeconds,
      distance_text: travel.data.distanceText ?? null,
      with_traffic: travel.data.withTraffic,
      departure_iso: departureISO ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travel.data]);

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
        <PlaceAutocompleteInput
          value={origin}
          onChange={setOrigin}
          placeholder="Tu punto de salida (dirección o lugar)"
          className="flex-1 min-w-0"
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
          {eventId && saveTravel.isSuccess && (
            <span className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" /> Guardado — se muestra como bloque antes del evento.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
