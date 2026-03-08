import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import {
  useMentionNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/hooks/useMentionNotifications";
import { formatMX } from "@/lib/dateUtils";
import {
  AlertTriangle, CalendarClock, Loader2, ArrowRight, User,
  AtSign, CheckCheck, MessageSquare,
} from "lucide-react";

export default function Notificaciones() {
  const navigate = useNavigate();
  const { data: alerts, isLoading: loadingAlerts } = useDueDateAlerts();
  const { data: mentions = [], isLoading: loadingMentions } = useMentionNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const unreadMentions = mentions.filter((m) => !m.is_read);

  const hasOverdue =
    (alerts?.overdue?.length ?? 0) > 0 || (alerts?.stepsOverdue?.length ?? 0) > 0;
  const hasDueSoon =
    (alerts?.dueSoon?.length ?? 0) > 0 || (alerts?.stepsDueSoon?.length ?? 0) > 0;

  const handleMentionClick = (m: typeof mentions[0]) => {
    if (!m.is_read) markAsRead.mutate(m.id);
    if (m.entity_type === "project" && m.entity_id) {
      navigate(`/proyectos/${m.entity_id}`);
    } else if (m.entity_type === "task" && m.entity_id) {
      navigate("/tareas");
    }
  };

  const isLoading = loadingAlerts || loadingMentions;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Notificaciones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Menciones, alertas de vencimiento y seguimiento
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="menciones">
            <TabsList>
              <TabsTrigger value="menciones" className="gap-1.5">
                <AtSign className="h-3.5 w-3.5" />
                Menciones
                {unreadMentions.length > 0 && (
                  <span className="ml-1 bg-primary text-primary-foreground text-[10px] rounded-full px-1.5 py-0 font-bold">
                    {unreadMentions.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="vencimientos" className="gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Vencimientos
              </TabsTrigger>
            </TabsList>

            {/* Mentions tab */}
            <TabsContent value="menciones" className="space-y-4 mt-4">
              {unreadMentions.length > 0 && (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => markAllAsRead.mutate()}
                    disabled={markAllAsRead.isPending}
                  >
                    <CheckCheck className="h-3.5 w-3.5 mr-1" />
                    Marcar todas como leídas
                  </Button>
                </div>
              )}

              {mentions.length === 0 ? (
                <div className="text-center py-16">
                  <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sin menciones aún. Cuando alguien te @mencione en un comentario aparecerá aquí.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {mentions.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        m.is_read
                          ? "hover:bg-secondary/30"
                          : "bg-primary/5 hover:bg-primary/10"
                      }`}
                      onClick={() => handleMentionClick(m)}
                    >
                      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                        <AvatarFallback className="text-xs">
                          {m.source_profile?.full_name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-foreground">
                            {m.title}
                          </span>
                          {!m.is_read && (
                            <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        {m.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            "{m.body}"
                          </p>
                        )}
                        <span className="text-[11px] text-muted-foreground mt-1 block">
                          {formatMX(m.created_at, "dd MMM yyyy HH:mm")}
                        </span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-1" />
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Due dates tab */}
            <TabsContent value="vencimientos" className="space-y-8 mt-4">
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
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
