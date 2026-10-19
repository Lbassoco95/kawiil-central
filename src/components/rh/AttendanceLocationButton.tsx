import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink, MapPin, MapPinOff } from "lucide-react";
import {
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  distanceMeters,
  formatDistance,
  googleMapsUrl,
  osmEmbedUrl,
  toCoord,
  type RhAttendance,
  type RhOfficeLocation,
} from "@/lib/rh";
import { useOfficeLocations } from "@/hooks/useRh";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function nearestOffice(lat: number, lng: number, offices: RhOfficeLocation[]) {
  let best: { office: RhOfficeLocation; distance: number } | null = null;
  for (const o of offices) {
    if (!o.is_active) continue;
    const d = distanceMeters(lat, lng, Number(o.latitude), Number(o.longitude));
    if (!best || d < best.distance) best = { office: o, distance: d };
  }
  return best;
}

/** G4: botón que abre el mapa con la ubicación donde se registró la entrada (y la salida). */
export function AttendanceLocationButton({
  attendance,
  personName,
}: {
  attendance: RhAttendance;
  personName: string;
}) {
  const [open, setOpen] = useState(false);
  const inLat = toCoord(attendance.check_in_lat);
  const inLng = toCoord(attendance.check_in_lng);
  const hasCheckIn = inLat !== null && inLng !== null;

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        onClick={() => setOpen(true)}
        title={hasCheckIn ? "Ver ubicación de la entrada" : "Sin ubicación registrada"}
        aria-label="Ver ubicación de la entrada"
      >
        {hasCheckIn ? (
          <MapPin className="h-4 w-4 text-primary" />
        ) : (
          <MapPinOff className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
      {open && (
        <AttendanceLocationDialog
          attendance={attendance}
          personName={personName}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

function AttendanceLocationDialog({
  attendance: a,
  personName,
  onOpenChange,
}: {
  attendance: RhAttendance;
  personName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: offices = [] } = useOfficeLocations();
  const inLat = toCoord(a.check_in_lat);
  const inLng = toCoord(a.check_in_lng);
  const outLat = toCoord(a.check_out_lat);
  const outLng = toCoord(a.check_out_lng);
  const accuracy = toCoord(a.check_in_accuracy_m);
  const hasCheckIn = inLat !== null && inLng !== null;
  const hasCheckOut = outLat !== null && outLng !== null;

  const officeInfo = useMemo(() => {
    if (!hasCheckIn) return null;
    const matched = a.office_location_id ? offices.find((o) => o.id === a.office_location_id) : null;
    if (matched) {
      return {
        name: matched.name,
        distance: distanceMeters(inLat!, inLng!, Number(matched.latitude), Number(matched.longitude)),
      };
    }
    const near = nearestOffice(inLat!, inLng!, offices);
    return near ? { name: near.office.name, distance: near.distance } : null;
  }, [hasCheckIn, inLat, inLng, a.office_location_id, offices]);

  const geofenceBadge =
    a.within_geofence === true ? (
      <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
        Dentro de geocerca
      </Badge>
    ) : a.within_geofence === false ? (
      <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-400">
        Fuera de geocerca
      </Badge>
    ) : null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            Ubicación de entrada
          </DialogTitle>
          <DialogDescription>
            {personName} · {WORK_MODE_EMOJI[a.work_mode]} {WORK_MODE_LABEL[a.work_mode]} ·{" "}
            {new Date(a.work_date + "T00:00:00").toLocaleDateString("es-MX", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}{" "}
            · entrada {fmtTime(a.check_in_at)}
          </DialogDescription>
        </DialogHeader>

        {hasCheckIn ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md border">
              <iframe
                title={`Ubicación de entrada de ${personName}`}
                src={osmEmbedUrl(inLat!, inLng!)}
                className="h-64 w-full"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {geofenceBadge}
              {accuracy !== null && (
                <Badge variant="secondary">Precisión ±{formatDistance(accuracy)}</Badge>
              )}
              {officeInfo && (
                <Badge variant="secondary">
                  {formatDistance(officeInfo.distance)} de {officeInfo.name}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-mono">
                {inLat!.toFixed(6)}, {inLng!.toFixed(6)}
              </span>
              <a
                href={googleMapsUrl(inLat!, inLng!)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Abrir en Google Maps <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Esta entrada no tiene ubicación registrada (el navegador no dio permiso de ubicación o no
            respondió a tiempo).
          </p>
        )}

        {a.check_out_at && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span>Salida {fmtTime(a.check_out_at)}</span>
            {hasCheckOut ? (
              <a
                href={googleMapsUrl(outLat!, outLng!)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Ver ubicación de salida <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span>sin ubicación de salida</span>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
