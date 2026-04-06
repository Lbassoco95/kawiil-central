import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Users } from "lucide-react";

type AdoptionPayload = {
  top_sections?: { section: string; n: number }[];
  active_users_7d?: number;
};

export function AdoptionAnalyticsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["activity-adoption-stats"],
    queryFn: async () => {
      const { data: raw, error } = await supabase.rpc("get_activity_adoption_stats");
      if (error) throw error;
      return (raw || {}) as AdoptionPayload;
    },
  });

  const sections = data?.top_sections ?? [];
  const active = data?.active_users_7d ?? 0;
  const empty = !isLoading && sections.length === 0 && active === 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Vistas de página registradas automáticamente (últimos 30 días por sección; usuarios distintos con actividad en 7 días).
      </p>

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : empty ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            Sin datos de adopción aún o sin permisos de administrador del módulo.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" /> Usuarios activos (7 días)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{active}</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Secciones más visitadas (30 días)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sections.map((s) => (
                  <div key={s.section} className="flex justify-between text-sm border-b border-border/40 pb-2 last:border-0">
                    <span className="font-medium capitalize">{s.section}</span>
                    <span className="text-muted-foreground">{s.n} vistas</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
