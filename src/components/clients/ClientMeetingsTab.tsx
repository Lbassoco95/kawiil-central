import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMtgSeriesForClient } from "@/hooks/useMtgSeriesForClient";
import { MTG_CADENCE_LABEL } from "@/lib/mtg/cadence";
import { Loader2, Users } from "lucide-react";
import { useProfiles } from "@/hooks/useTasks";

interface ClientMeetingsTabProps {
  clientId: string;
}

export function ClientMeetingsTab({ clientId }: ClientMeetingsTabProps) {
  const { data: series = [], isLoading, error } = useMtgSeriesForClient(clientId);
  const { data: profiles = [] } = useProfiles();
  const nameByUserId = new Map(profiles.map((p) => [p.user_id, p.full_name]));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando juntas…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-4">
        No se pudieron cargar las series de junta. ¿Aplicaste las migraciones mtg en Supabase?
      </p>
    );
  }

  if (series.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No hay series de junta configuradas para este cliente. En el Bloque 2 podrás crearlas desde aquí.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Series recurrentes (Múuch&apos;) ligadas a este cliente o a un grupo del que forma parte.
      </p>
      {series.map((s) => (
        <Card key={s.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-base">{s.title}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{MTG_CADENCE_LABEL[s.cadence]}</Badge>
                {s.anchor_type === "group" && (
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" />
                    Grupo
                  </Badge>
                )}
                {!s.active && <Badge variant="destructive">Inactiva</Badge>}
              </div>
            </div>
            <CardDescription>
              Responsable de junta: {nameByUserId.get(s.owner_user_id) ?? "—"} ·{" "}
              {s.default_duration_min} min
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {s.teams_join_url ? (
              <a
                href={s.teams_join_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Enlace Teams
              </a>
            ) : (
              "Sin enlace Teams (se vincula en Bloque 3 con Outlook)."
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
