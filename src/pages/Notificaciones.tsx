import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import { formatMX } from "@/lib/dateUtils";
import { AlertTriangle, CalendarClock, Loader2, ArrowRight, User } from "lucide-react";

export default function Notificaciones() {
  const { data: alerts, isLoading } = useDueDateAlerts();

  const hasOverdue =
    (alerts?.overdue?.length ?? 0) > 0 || (alerts?.stepsOverdue?.length ?? 0) > 0;
  const hasDueSoon =
    (alerts?.dueSoon?.length ?? 0) > 0 || (alerts?.stepsDueSoon?.length ?? 0) > 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Notificaciones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Alertas de tareas y obligaciones que ya vencieron o están por vencer
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Vencidas */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vencidas</h2>
              </div>
              {hasOverdue ? (
                <div className="space-y-2">
                  {(alerts?.overdue ?? []).map((t) => (
                    <div key={t.id} className="rounded-xl bg-destructive/5 p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground">{t.title}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-destructive font-medium">
                            Venció el {formatMX(t.due_date, "dd MMM yyyy")}
                          </span>
                          {t.assigned_to_me && (
                            <Badge variant="outline" className="text-[10px] border-0 bg-destructive/10 text-destructive px-1.5 py-0">
                              <User className="h-3 w-3 mr-0.5" /> tuya
                            </Badge>
                          )}
                        </div>
                      </div>
                      {(t.client_name || t.project_name) && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs text-primary" asChild>
                        <Link to="/tareas">Ver tarea <ArrowRight className="h-3 w-3 ml-1" /></Link>
                      </Button>
                    </div>
                  ))}
                  {(alerts?.stepsOverdue ?? []).map((s) => (
                    <div key={s.id} className="rounded-xl bg-destructive/5 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-foreground">{s.label}</span>
                        <span className="text-[11px] text-destructive font-medium">
                          Venció el {formatMX(s.due_date, "dd MMM yyyy")}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {s.project_name} — Período {s.period_label}
                      </p>
                      <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs text-primary" asChild>
                        <Link to="/proyectos">Ver proyectos <ArrowRight className="h-3 w-3 ml-1" /></Link>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No hay tareas ni obligaciones vencidas.
                </p>
              )}
            </section>

            {/* Por vencer */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <CalendarClock className="h-4 w-4 text-warning" />
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Por vencer (próximos 14 días)</h2>
              </div>
              {hasDueSoon ? (
                <div className="space-y-2">
                  {(alerts?.dueSoon ?? []).map((t) => (
                    <div key={t.id} className="rounded-xl bg-warning/5 p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{t.title}</p>
                          {(t.client_name || t.project_name) && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {t.assigned_to_me && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-primary mt-1">
                              <User className="h-3 w-3" /> Asignada a ti
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium text-warning">
                            Vence: {formatMX(t.due_date, "dd MMM yyyy")}
                          </span>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <Link to="/tareas">Ver <ArrowRight className="h-3 w-3 ml-0.5" /></Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(alerts?.stepsDueSoon ?? []).map((s) => (
                    <div key={s.id} className="rounded-xl bg-warning/5 p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-[13px] font-medium text-foreground">{s.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {s.project_name} — Período {s.period_label}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium text-warning">
                            Vence: {formatMX(s.due_date, "dd MMM yyyy")}
                          </span>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <Link to="/proyectos">Ver <ArrowRight className="h-3 w-3 ml-0.5" /></Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No hay tareas ni obligaciones por vencer en los próximos 14 días.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
