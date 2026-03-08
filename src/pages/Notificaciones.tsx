import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import { formatMX } from "@/lib/dateUtils";
import { Bell, AlertTriangle, CalendarClock, Loader2, ArrowRight, User } from "lucide-react";

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
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="h-7 w-7 text-primary" />
            Notificaciones
          </h1>
          <p className="text-sm text-muted-foreground">
            Alertas de tareas y obligaciones que ya vencieron o están por vencer
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Vencidas */}
            <section>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Vencidas
              </h2>
              {hasOverdue ? (
                <div className="space-y-2">
                  {(alerts?.overdue ?? []).map((t) => (
                    <Alert
                      key={t.id}
                      variant="destructive"
                      className="py-3"
                    >
                      <AlertTitle className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium">{t.title}</span>
                        <span className="text-xs font-normal">
                          Venció el {formatMX(t.due_date, "dd MMM yyyy")}
                          {t.assigned_to_me && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-destructive/90">
                              <User className="h-3 w-3" /> asignada a ti
                            </span>
                          )}
                        </span>
                      </AlertTitle>
                      <AlertDescription className="mt-1">
                        {(t.client_name || t.project_name) && (
                          <p className="text-xs opacity-90">
                            {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <Button variant="outline" size="sm" className="mt-2 border-white/30 text-white hover:bg-white/10" asChild>
                          <Link to="/tareas">Ver tarea</Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ))}
                  {(alerts?.stepsOverdue ?? []).map((s) => (
                    <Alert key={s.id} variant="destructive" className="py-3">
                      <AlertTitle className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium">{s.label}</span>
                        <span className="text-xs font-normal">
                          Venció el {formatMX(s.due_date, "dd MMM yyyy")}
                        </span>
                      </AlertTitle>
                      <AlertDescription>
                        <p className="text-xs opacity-90">
                          {s.project_name} — Período {s.period_label}
                        </p>
                        <Button variant="outline" size="sm" className="mt-2 border-white/30 text-white hover:bg-white/10" asChild>
                          <Link to="/proyectos">Ver proyectos</Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-4 text-center text-sm text-muted-foreground">
                    No hay tareas ni obligaciones vencidas.
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Por vencer */}
            <section>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <CalendarClock className="h-4 w-4 text-amber-500" />
                Por vencer (próximos 14 días)
              </h2>
              {hasDueSoon ? (
                <div className="space-y-2">
                  {(alerts?.dueSoon ?? []).map((t) => (
                    <Card key={t.id} className="border-amber-200 dark:border-amber-900/50">
                      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{t.title}</p>
                          {(t.client_name || t.project_name) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {t.assigned_to_me && (
                            <span className="inline-flex items-center gap-1 text-xs text-primary mt-1">
                              <User className="h-3 w-3" /> Asignada a ti
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            Vence: {formatMX(t.due_date, "dd MMM yyyy")}
                          </span>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/tareas" className="gap-1">
                              Ver <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {(alerts?.stepsDueSoon ?? []).map((s) => (
                    <Card key={s.id} className="border-amber-200 dark:border-amber-900/50">
                      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="font-medium text-foreground">{s.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.project_name} — Período {s.period_label}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            Vence: {formatMX(s.due_date, "dd MMM yyyy")}
                          </span>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/proyectos" className="gap-1">
                              Ver <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-4 text-center text-sm text-muted-foreground">
                    No hay tareas ni obligaciones por vencer en los próximos 14 días.
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
