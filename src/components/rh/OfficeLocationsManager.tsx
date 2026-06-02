import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Plus, Crosshair } from "lucide-react";
import { toast } from "sonner";
import { getCurrentPosition } from "@/lib/rh";
import { useOfficeLocations, useSaveOfficeLocation } from "@/hooks/useRh";

export function OfficeLocationsManager() {
  const { data: offices = [], isLoading } = useOfficeLocations();
  const save = useSaveOfficeLocation();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("150");
  const [locating, setLocating] = useState(false);

  async function useMyLocation() {
    setLocating(true);
    try {
      const fix = await getCurrentPosition();
      setLat(fix.lat.toFixed(6));
      setLng(fix.lng.toFixed(6));
      toast.success("Ubicación actual capturada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLocating(false);
    }
  }

  function handleSave() {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radius_meters = parseInt(radius, 10);
    if (!name.trim() || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      toast.error("Completa nombre y coordenadas válidas.");
      return;
    }
    save.mutate(
      { name: name.trim(), address: address.trim() || null, latitude, longitude, radius_meters: radius_meters || 150 },
      {
        onSuccess: () => {
          setName("");
          setAddress("");
          setLat("");
          setLng("");
          setRadius("150");
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-primary" />
          Oficinas y geocercas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : offices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay oficinas registradas. Agrega una para validar los check-in en sitio.
          </p>
        ) : (
          <ul className="divide-y">
            {offices.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)} · radio {o.radius_meters} m
                  </div>
                </div>
                <Badge variant={o.is_active ? "secondary" : "outline"}>
                  {o.is_active ? "Activa" : "Inactiva"}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">Nueva oficina</p>
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Oficina CDMX" />
          </div>
          <div className="space-y-1.5">
            <Label>Dirección (opcional)</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Latitud</Label>
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.4326" />
            </div>
            <div className="space-y-1.5">
              <Label>Longitud</Label>
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-99.1332" />
            </div>
            <div className="space-y-1.5">
              <Label>Radio (m)</Label>
              <Input value={radius} onChange={(e) => setRadius(e.target.value)} type="number" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={useMyLocation} disabled={locating}>
              {locating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Crosshair className="mr-1.5 h-3.5 w-3.5" />}
              Usar mi ubicación
            </Button>
            <Button size="sm" onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Agregar oficina
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
