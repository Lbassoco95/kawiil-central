import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PartyPopper, Calendar, User, Wallet } from "lucide-react";
import { ActivityFormDialog } from "@/components/actividades/ActivityFormDialog";
import { useActivities, type Activity } from "@/hooks/useActivities";
import {
  ACTIVITY_TYPE_LABELS, activityStatusLabel,
  ACTIVITY_STATUS_STYLES, type ActivityStatus, type ActivityType,
} from "@/lib/activityTypes";
import { formatMxn } from "@/lib/pipelineFormat";
import { formatDateMX } from "@/lib/dateUtils";

const TYPE_ORDER: ActivityType[] = ["convivencia", "capacitacion", "despacho", "otro"];

const Actividades = () => {
  const navigate = useNavigate();
  const { data: activities, isLoading } = useActivities();

  const list = useMemo(() => activities ?? [], [activities]);

  const heroStats: PageHeaderStat[] = useMemo(() => {
    const activas = list.filter((a) => a.status === "en_curso").length;
    const totalEst = list.reduce((s, a) => s + (a.budget_estimated ?? 0), 0);
    return [
      { label: "Actividades", value: list.length },
      { label: "En curso", value: activas, tone: "primary" },
      { label: "Presupuesto estimado", value: formatMxn(totalEst, { compact: false }), sub: "Suma de todas" },
    ];
  }, [list]);

  // Agrupa por tipo, respetando el orden definido.
  const grouped = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of list) {
      const key = a.activity_type || "otro";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return TYPE_ORDER
      .filter((t) => map.has(t))
      .map((t) => ({ type: t, label: ACTIVITY_TYPE_LABELS[t], items: map.get(t)! }));
  }, [list]);

  return (
    <AppLayout>
      <div className="kwv24 space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          icon={<PartyPopper />}
          breadcrumb={["Kawiil OS", "Trabajo", "Actividades"]}
          iconAccent="linear-gradient(135deg, hsl(330 75% 55%), hsl(25 85% 55%))"
          title="Actividades"
          description="Control y seguimiento de actividades internas del despacho: convivencias, capacitaciones/cursos y eventos del equipo. No son trabajos de cliente."
          stats={heroStats}
          actions={<ActivityFormDialog />}
        />

        {isLoading ? (
          <p className="text-center text-muted-foreground py-12">Cargando...</p>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <PartyPopper className="h-10 w-10 mx-auto text-muted-foreground/60" />
              <p className="text-muted-foreground">
                Aún no hay actividades. Crea la primera (por ejemplo, la convivencia de Fin de Año).
              </p>
              <div className="flex justify-center">
                <ActivityFormDialog />
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <section key={group.type} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {group.label} · {group.items.length}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((a) => (
                    <Card
                      key={a.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => navigate(`/actividades/${a.id}`)}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold leading-tight">{a.name}</h3>
                          <Badge
                            variant="outline"
                            className={ACTIVITY_STATUS_STYLES[a.status as ActivityStatus]}
                          >
                            {activityStatusLabel(a.status)}
                          </Badge>
                        </div>
                        <div className="space-y-1.5 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{a.event_date ? formatDateMX(a.event_date) : "Fecha por definir"}</span>
                          </div>
                          {a.location && (
                            <div className="flex items-center gap-2">
                              <User className="h-3.5 w-3.5" />
                              <span className="truncate">{a.location}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <Wallet className="h-3.5 w-3.5" />
                            <span>
                              {formatMxn(a.budget_spent, { compact: false })}
                              {" / "}
                              {formatMxn(a.budget_estimated, { compact: false })}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Actividades;
