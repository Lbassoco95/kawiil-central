import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import {
  useMentionNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/hooks/useMentionNotifications";
import { formatMX } from "@/lib/dateUtils";
import {
  AlertTriangle, CalendarClock, Loader2, ArrowRight,
  AtSign, CheckCheck, MessageSquare, ClipboardList, DollarSign, Activity,
} from "lucide-react";

type Tab = "menciones" | "actividad" | "vencimientos";

const MENTION_TYPES = ["mention"];
const ACTIVITY_TYPES = ["task_assigned", "task_reassigned", "expense_created", "expense_status_changed"];

function getNotificationIcon(type: string) {
  if (type === "task_assigned" || type === "task_reassigned") return <ClipboardList className="h-3.5 w-3.5 text-primary" />;
  if (type === "expense_created" || type === "expense_status_changed") return <DollarSign className="h-3.5 w-3.5 text-emerald-500" />;
  return <AtSign className="h-3.5 w-3.5 text-primary" />;
}

export default function Notificaciones() {
  const navigate = useNavigate();
  const { data: alerts, isLoading: loadingAlerts } = useDueDateAlerts();
  const { data: allNotifications = [], isLoading: loadingMentions } = useMentionNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const [tab, setTab] = useState<Tab>("menciones");

  const mentions = allNotifications.filter((n) => MENTION_TYPES.includes(n.type));
  const activityItems = allNotifications.filter((n) => ACTIVITY_TYPES.includes(n.type));
  const unreadMentions = mentions.filter((m) => !m.is_read);
  const unreadActivity = activityItems.filter((a) => !a.is_read);

  const hasOverdue =
    (alerts?.overdue?.length ?? 0) > 0 || (alerts?.stepsOverdue?.length ?? 0) > 0;
  const hasDueSoon =
    (alerts?.dueSoon?.length ?? 0) > 0 || (alerts?.stepsDueSoon?.length ?? 0) > 0;

  const handleNotificationClick = (m: typeof allNotifications[0]) => {
    if (!m.is_read) markAsRead.mutate(m.id);

    if (m.entity_type === "project" && m.entity_id) {
      navigate(`/proyectos/${m.entity_id}?tab=comentarios`);
    } else if (m.entity_type === "task" && m.entity_id) {
      navigate(`/tareas?taskId=${m.entity_id}`);
    } else if (m.entity_type === "expense") {
      navigate("/finanzas");
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

  const currentList = tab === "menciones" ? mentions : tab === "actividad" ? activityItems : [];
  const currentUnread = tab === "menciones" ? unreadMentions : unreadActivity;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "menciones", label: "Menciones", icon: <AtSign className="h-3 w-3" />, badge: unreadMentions.length },
    { key: "actividad", label: "Actividad", icon: <Activity className="h-3 w-3" />, badge: unreadActivity.length },
    { key: "vencimientos", label: "Vencimientos", icon: <CalendarClock className="h-3 w-3" /> },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Notificaciones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Menciones, actividad del equipo y alertas de vencimiento
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* Tab pills */}
            <div className="flex gap-1.5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`tab-pill inline-flex items-center gap-1.5 ${
                    tab === t.key ? "tab-pill-active" : "tab-pill-inactive"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {(t.badge ?? 0) > 0 && (
                    <span className="bg-primary-foreground/20 text-[10px] rounded-full px-1.5 font-bold animate-pulse-soft">
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Mentions & Activity lists */}
            {(tab === "menciones" || tab === "actividad") && (
              <div className="space-y-4">
                {currentUnread.length > 0 && (
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

                {currentList.length === 0 ? (
                  <div className="text-center py-16">
                    {tab === "menciones" ? (
                      <>
                        <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 text-sm text-muted-foreground">
                          Sin menciones aún. Cuando alguien te @mencione aparecerá aquí.
                        </p>
                      </>
                    ) : (
                      <>
                        <Activity className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 text-sm text-muted-foreground">
                          Sin actividad reciente. Asignaciones de tareas y gastos aparecerán aquí.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {currentList.map((m, i) => (
                      <div
                        key={m.id}
                        className={`flex items-start gap-3 py-3 px-3 rounded-xl cursor-pointer transition-all duration-200 border animate-fade-in ${
                          m.is_read
                            ? "hover:bg-secondary/30 border-transparent"
                            : "bg-primary/[0.03] border-primary/10 hover:bg-primary/[0.06]"
                        }`}
                        style={{ animationDelay: `${Math.min(i, 8) * 30}ms`, animationFillMode: "both" }}
                        onClick={() => handleNotificationClick(m)}
                      >
                        {tab === "menciones" ? (
                          <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                            <AvatarFallback className="text-[10px] bg-secondary">
                              {m.source_profile?.full_name?.charAt(0) || "?"}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="h-7 w-7 shrink-0 mt-0.5 rounded-full bg-secondary flex items-center justify-center">
                            {getNotificationIcon(m.type)}
                          </div>
                        )}
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
              <div className="space-y-8 animate-fade-in">
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
