import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, X, UserPlus } from "lucide-react";
import { useProfiles } from "@/hooks/useTasks";
import { useUpdateActivity, type Activity } from "@/hooks/useActivities";
import {
  useActivityManagers, useAddActivityManager, useRemoveActivityManager,
} from "@/hooks/useActivityExtras";

/**
 * Equipo y visibilidad de la actividad (solo G4).
 *  - Ayudantes: kawiilers que ven y manejan SOLO esta actividad (asistentes, proveedores, tareas).
 *  - Visible para el equipo: si está encendido, cada invitado ligado a su cuenta ve su propia invitación
 *    (fecha, hora, sede confirmada y el anuncio). Nunca ve a los demás invitados ni lo demás.
 */
export function ActivityAccessCard({ activity }: { activity: Activity }) {
  const { data: profiles } = useProfiles();
  const { data: managers } = useActivityManagers(activity.id);
  const addManager = useAddActivityManager();
  const removeManager = useRemoveActivityManager();
  const updateActivity = useUpdateActivity();

  const [pick, setPick] = useState("");
  const [announcement, setAnnouncement] = useState(activity.team_announcement ?? "");
  useEffect(() => { setAnnouncement(activity.team_announcement ?? ""); }, [activity.team_announcement]);

  const nameOf = (uid: string) => {
    const p = (profiles ?? []).find((x) => x.user_id === uid);
    return p?.full_name || p?.email || "Usuario";
  };
  const assigned = new Set((managers ?? []).map((m) => m.user_id));
  // El responsable ya administra la actividad; no hace falta asignarlo como ayudante.
  const candidates = (profiles ?? []).filter(
    (p) => p.user_id && !assigned.has(p.user_id) && p.user_id !== activity.responsible_user_id,
  );
  const dirty = (announcement.trim() || null) !== (activity.team_announcement ?? null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Quién administra esta actividad
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            G4 y el responsable la administran siempre. Los ayudantes que asignes ven y manejan solo esta actividad
            (asistentes, proveedores, tareas) y el módulo Actividades con solo ella.
          </p>
          <div className="flex flex-wrap gap-2">
            {(managers ?? []).length === 0 && (
              <span className="text-sm text-muted-foreground">Sin ayudantes asignados.</span>
            )}
            {(managers ?? []).map((m) => (
              <Badge key={m.user_id} variant="outline" className="gap-1.5 py-1 pl-2.5 pr-1">
                {nameOf(m.user_id)}
                <button
                  type="button" aria-label={`Quitar a ${nameOf(m.user_id)}`}
                  className="rounded-full p-0.5 hover:bg-muted"
                  onClick={() => removeManager.mutate({ activityId: activity.id, userId: m.user_id })}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Elegir kawiiler…" /></SelectTrigger>
              <SelectContent>
                {candidates.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name || p.email}{p.email && p.full_name ? ` · ${p.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm" disabled={!pick || addManager.isPending}
              onClick={() => addManager.mutate({ activityId: activity.id, userId: pick }, { onSuccess: () => setPick("") })}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Asignar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Visible para los invitados del equipo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="team-visible">Mostrar “Mis invitaciones” a los kawiilers invitados</Label>
              <p className="text-xs text-muted-foreground">
                Cada invitado ligado a su cuenta ve solo su invitación: si fue confirmada o rechazada, su +1 y sus
                invitados extra, más la fecha, la hora, la sede (si está confirmada) y el anuncio. Nada de los demás.
              </p>
            </div>
            <Switch
              id="team-visible" checked={activity.team_visible}
              disabled={updateActivity.isPending}
              onCheckedChange={(v) => updateActivity.mutate({ id: activity.id, team_visible: v })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-announcement">Anuncio para el equipo (opcional)</Label>
            <Textarea
              id="team-announcement" rows={3} maxLength={500} value={announcement}
              placeholder="Ej: Lleven su regalo para el amigo secreto."
              onChange={(e) => setAnnouncement(e.target.value)}
            />
            <Button
              size="sm" variant="outline" disabled={!dirty || updateActivity.isPending}
              onClick={() => updateActivity.mutate({ id: activity.id, team_announcement: announcement.trim() || null })}
            >
              Guardar anuncio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
