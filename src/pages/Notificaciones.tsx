import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  const [tab, setTab] = useState<"menciones" | "vencimientos">("menciones");

  const unreadMentions = mentions.filter((m) => !m.is_read);

  const hasOverdue =
    (alerts?.overdue?.length ?? 0) > 0 || (alerts?.stepsOverdue?.length ?? 0) > 0;
  const hasDueSoon =
    (alerts?.dueSoon?.length ?? 0) > 0 || (alerts?.stepsDueSoon?.length ?? 0) > 0;

  const handleMentionClick = (m: typeof mentions[0]) => {
    if (!m.is_read) markAsRead.mutate(m.id);
    if (m.entity_type === "project" && m.entity_id) {
      // Extract step_key from title if it's a step mention (format: "...te mencionó en "StepLabel"")
      navigate(`/proyectos/${m.entity_id}?tab=comentarios`);
    } else if (m.entity_type === "task" && m.entity_id) {
      navigate(`/tareas?taskId=${m.entity_id}`);
    }
  };

  const handleTaskAlertClick = (t: { id: string; project_id?: string | null }) => {
    if (t.project_id) {
      navigate(`/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}`);
    } else {
      navigate(`/tareas?taskId=${t.id}`);
    }
  };

  const handleStepAlertClick = (s: { project_id: string; step_key: string }) => {
    navigate(`/proyectos/${s.project_id}?tab=contabilidad&step=${s.step_key}`);
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
          <>
            {/* Tab pills */}
            <div className="flex gap-1.5">
              <button
                onClick={() => setTab("menciones")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  tab === "menciones"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <AtSign className="h-3 w-3" />
                Menciones
                {unreadMentions.length > 0 && (
                  <span className="bg-primary-foreground/20 text-[10px] rounded-full px-1.5 font-bold">
                    {unreadMentions.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setTab("vencimientos")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  tab === "vencimientos"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <CalendarClock className="h-3 w-3" />
                Vencimientos
              </button>
            </div>

            {/* Mentions */}
            {tab === "menciones" && (
              <div className="space-y-4">
                {unreadMentions.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      onClick={() => markAllAsRead.mutate()}
                      disabled={markAllAsRead.isPending}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Marcar todas como leídas
                    </button>
                  </div>
                )}

                {mentions.length === 0 ? (
                  <div className="text-center py-16">
                    <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      Sin menciones aún. Cuando alguien te @mencione aparecerá aquí.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {mentions.map((m) => (
                      <div
                        key={m.id}
                        className={`flex items-start gap-3 py-3 px-2 -mx-2 rounded-lg cursor-pointer transition-colors ${
                          m.is_read ? "hover:bg-secondary/30" : "hover:bg-primary/5"
                        }`}
                        onClick={() => handleMentionClick(m)}
                      >
                        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                          <AvatarFallback className="text-[10px] bg-secondary">
                            {m.source_profile?.full_name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-foreground">
                              {m.title}
                            </span>
                            {!m.is_read && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
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
                        <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-2" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Due dates */}
            {tab === "vencimientos" && (
              <div className="space-y-8">
                {/* Overdue */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Vencidas</h2>
                  </div>
                  {hasOverdue ? (
                    <div className="divide-y divide-border/40">
                      {(alerts?.overdue ?? []).map((t) => (
                        <div
                          key={t.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleTaskAlertClick(t)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground">{t.title}</span>
                            <span className="text-[11px] text-destructive shrink-0">
                              Venció {formatMX(t.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                          {(t.client_name || t.project_name) && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                      ))}
                      {(alerts?.stepsOverdue ?? []).map((s) => (
                        <div
                          key={s.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleStepAlertClick(s)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground">{s.label}</span>
                            <span className="text-[11px] text-destructive shrink-0">
                              Venció {formatMX(s.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {s.project_name} — {s.period_label}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No hay tareas vencidas.</p>
                  )}
                </section>

                {/* Due soon */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarClock className="h-3.5 w-3.5 text-warning" />
                    <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Por vencer (14 días)</h2>
                  </div>
                  {hasDueSoon ? (
                    <div className="divide-y divide-border/40">
                      {(alerts?.dueSoon ?? []).map((t) => (
                        <div
                          key={t.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleTaskAlertClick(t)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground">{t.title}</p>
                              {(t.client_name || t.project_name) && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            <span className="text-[11px] text-warning shrink-0">
                              Vence {formatMX(t.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                        </div>
                      ))}
                      {(alerts?.stepsDueSoon ?? []).map((s) => (
                        <div
                          key={s.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleStepAlertClick(s)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-[13px] font-medium text-foreground">{s.label}</p>
                              <p className="text-[11px] text-muted-foreground">{s.project_name} — {s.period_label}</p>
                            </div>
                            <span className="text-[11px] text-warning shrink-0">
                              Vence {formatMX(s.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No hay tareas por vencer en los próximos 14 días.</p>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
