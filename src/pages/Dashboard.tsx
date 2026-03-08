import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckSquare,
  Users,
  FolderKanban,
  AlertTriangle,
  ArrowRight,
  Clock,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { formatDateMX, nowMX } from "@/lib/dateUtils";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { useUserRole } from "@/hooks/useUserRole";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: orgUsers } = useOrgUsers();

  const { data: allTasks } = useQuery({
    queryKey: ["dashboard-all-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, assigned_to, project_id, client_id, area")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const pendingTasks = useMemo(
    () => allTasks?.filter((t) => ["pendiente", "en_progreso", "en_revision"].includes(t.status)) ?? [],
    [allTasks]
  );

  const completedTasks = useMemo(
    () => allTasks?.filter((t) => t.status === "completada") ?? [],
    [allTasks]
  );

  const activeClients = useMemo(() => clients?.filter((c) => c.status === "activo").length ?? 0, [clients]);
  const activeProjects = useMemo(() => projects?.filter((p) => p.status === "activo").length ?? 0, [projects]);

  const today = useMemo(() => nowMX(), []);
  const dueSoon = useMemo(() => {
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    return pendingTasks.filter((t) => t.due_date && new Date(t.due_date) <= in7Days).length;
  }, [pendingTasks, today]);

  const myTasks = useMemo(
    () => pendingTasks.filter((t) => t.assigned_to === user?.id).slice(0, 6),
    [pendingTasks, user]
  );

  // ── Team workload ──
  const teamWorkload = useMemo(() => {
    if (!orgUsers || !allTasks) return [];
    const activeUsers = orgUsers.filter((u) => u.is_active && u.invitation_accepted);
    return activeUsers.map((u) => {
      const userTasks = allTasks.filter((t) => t.assigned_to === u.user_id);
      const pending = userTasks.filter((t) => ["pendiente", "en_progreso", "en_revision"].includes(t.status)).length;
      const completed = userTasks.filter((t) => t.status === "completada").length;
      const total = pending + completed;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const overdue = userTasks.filter(
        (t) => ["pendiente", "en_progreso", "en_revision"].includes(t.status) && t.due_date && new Date(t.due_date) < today
      ).length;
      return {
        userId: u.user_id,
        name: u.full_name,
        area: u.area,
        pending,
        completed,
        total,
        pct,
        overdue,
        isMe: u.user_id === user?.id,
      };
    }).filter((u) => u.total > 0).sort((a, b) => b.pending - a.pending);
  }, [orgUsers, allTasks, user, today]);

  // ── Project progress ──
  const projectProgress = useMemo(() => {
    if (!projects || !allTasks) return [];
    return projects
      .filter((p) => p.status === "activo")
      .map((p) => {
        const pt = allTasks.filter((t) => t.project_id === p.id);
        const total = pt.length;
        const completed = pt.filter((t) => t.status === "completada").length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return {
          id: p.id,
          name: p.name,
          clientName: (p as any).clients?.name ?? "—",
          area: p.area,
          total,
          completed,
          pct,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [projects, allTasks]);

  // ── Client progress ──
  const clientProgress = useMemo(() => {
    if (!clients || !allTasks) return [];
    return clients
      .filter((c) => c.status === "activo")
      .map((c) => {
        const ct = allTasks.filter((t) => t.client_id === c.id);
        const total = ct.length;
        const completed = ct.filter((t) => t.status === "completada").length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { id: c.id, name: c.name, total, completed, pct };
      })
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [clients, allTasks]);

  // ── Area indicators ──
  const areaStats = useMemo(() => {
    if (!allTasks) return [];
    const areas: Record<string, { pending: number; completed: number; overdue: number }> = {};
    allTasks.forEach((t) => {
      const a = t.area || "sin_area";
      if (a === "sin_area") return;
      if (!areas[a]) areas[a] = { pending: 0, completed: 0, overdue: 0 };
      if (t.status === "completada") {
        areas[a].completed++;
      } else if (["pendiente", "en_progreso", "en_revision"].includes(t.status)) {
        areas[a].pending++;
        if (t.due_date && new Date(t.due_date) < today) areas[a].overdue++;
      }
    });
    return Object.entries(areas)
      .map(([key, val]) => {
        const total = val.pending + val.completed;
        const pct = total > 0 ? Math.round((val.completed / total) * 100) : 0;
        return {
          area: key,
          label: SERVICE_LABELS[key as keyof typeof SERVICE_LABELS] || key,
          ...val,
          total,
          pct,
          status: val.overdue > 0 ? "danger" : val.pending > 5 ? "warning" : "ok",
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [allTasks, today]);

  const stats = [
    { label: "Clientes activos", value: activeClients, icon: Users, href: "/clientes" },
    { label: "Proyectos activos", value: activeProjects, icon: FolderKanban, href: "/proyectos" },
    { label: "Tareas pendientes", value: pendingTasks.length, icon: CheckSquare, href: "/tareas" },
    { label: "Por vencer (7d)", value: dueSoon, icon: AlertTriangle, href: "/tareas", highlight: dueSoon > 0 },
  ];

  const priorityColor = (p: string) => {
    switch (p) {
      case "urgente": return "bg-destructive/10 text-destructive border-destructive/20";
      case "alta": return "bg-warning/10 text-warning border-warning/20";
      case "media": return "bg-primary/10 text-primary border-primary/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const statusDot = (s: string) => {
    switch (s) {
      case "danger": return "bg-destructive";
      case "warning": return "bg-warning";
      default: return "bg-success";
    }
  };

  const progressColor = (pct: number) => {
    if (pct >= 75) return "text-success";
    if (pct >= 40) return "text-primary";
    return "text-muted-foreground";
  };

  const workloadLevel = (pending: number, overdue: number) => {
    if (overdue > 0) return "border-destructive/30 bg-destructive/5";
    if (pending > 8) return "border-warning/30 bg-warning/5";
    if (pending <= 2) return "border-success/30 bg-success/5";
    return "";
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Vista colaborativa del equipo</p>
        </div>

        {/* Stats */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className={`cursor-pointer hover:shadow-md transition-shadow ${stat.highlight ? "border-destructive/40" : ""}`}
              onClick={() => navigate(stat.href)}
            >
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
                  <stat.icon className={`h-4 w-4 ${stat.highlight ? "text-destructive" : "text-primary"}`} />
                </div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Area Indicators with progress */}
        {areaStats.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Avance por célula
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {areaStats.map((a) => (
                  <div key={a.area} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusDot(a.status)}`} />
                        <span className="text-sm font-medium">{a.label}</span>
                      </div>
                      <span className={`text-sm font-bold ${progressColor(a.pct)}`}>{a.pct}%</span>
                    </div>
                    <Progress value={a.pct} className="h-1.5 mb-2" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>{a.completed} completadas</span>
                      <span>{a.pending} pendientes</span>
                      {a.overdue > 0 && <span className="text-destructive font-medium">{a.overdue} vencidas</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Team Workload */}
        {isAdminOrManager && teamWorkload.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-primary" />
                Carga del equipo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {teamWorkload.map((m) => (
                  <div
                    key={m.userId}
                    className={`rounded-lg border p-3 transition-colors ${workloadLevel(m.pending, m.overdue)} ${m.isMe ? "ring-1 ring-primary/30" : ""}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="text-sm font-medium block truncate">
                          {m.name}
                          {m.isMe && <span className="text-[10px] text-primary ml-1">(tú)</span>}
                        </span>
                        {m.area && <span className="text-[10px] text-muted-foreground">{m.area}</span>}
                      </div>
                      <span className={`text-sm font-bold ${progressColor(m.pct)}`}>{m.pct}%</span>
                    </div>
                    <Progress value={m.pct} className="h-1.5 mb-1.5" />
                    <div className="flex gap-3 text-[11px] text-muted-foreground">
                      <span>{m.pending} pendientes</span>
                      <span>{m.completed} hechas</span>
                      {m.overdue > 0 && <span className="text-destructive font-medium">{m.overdue} vencidas</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* My Tasks */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Mis tareas
              </CardTitle>
              <button
                onClick={() => navigate("/tareas")}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Ver todas <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent>
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Sin tareas pendientes asignadas 🎉
                </p>
              ) : (
                <div className="space-y-1.5">
                  {myTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-md border p-2.5 text-sm hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => navigate("/tareas")}
                    >
                      <span className="truncate flex-1 mr-2">{t.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {t.due_date && (
                          <span className={`text-[11px] ${new Date(t.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {formatDateMX(t.due_date)}
                          </span>
                        )}
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityColor(t.priority)}`}>
                          {t.priority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Project Progress */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-primary" />
                Avance de proyectos
              </CardTitle>
              <button
                onClick={() => navigate("/proyectos")}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Ver todos <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent>
              {projectProgress.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin proyectos activos</p>
              ) : (
                <div className="space-y-3">
                  {projectProgress.map((p) => (
                    <div
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50 rounded-md p-2.5 -mx-1 transition-colors"
                      onClick={() => navigate(`/proyectos/${p.id}`)}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="min-w-0 flex-1 mr-2">
                          <span className="text-sm font-medium truncate block">{p.clientName}</span>
                          <span className="text-xs text-muted-foreground truncate block">{p.name}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-sm font-semibold ${progressColor(p.pct)}`}>{p.pct}%</span>
                          <span className="text-[10px] text-muted-foreground block">{p.completed}/{p.total}</span>
                        </div>
                      </div>
                      <Progress value={p.pct} className="h-1.5" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Client Progress */}
        {clientProgress.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Avance por cliente
              </CardTitle>
              <button
                onClick={() => navigate("/clientes")}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Ver todos <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {clientProgress.map((c) => (
                  <div
                    key={c.id}
                    className="cursor-pointer rounded-lg border p-3 hover:shadow-sm transition-shadow"
                    onClick={() => navigate(`/clientes/${c.id}`)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium truncate flex-1 mr-2">{c.name}</span>
                      <span className={`text-sm font-bold ${progressColor(c.pct)}`}>{c.pct}%</span>
                    </div>
                    <Progress value={c.pct} className="h-1.5 mb-1" />
                    <span className="text-[10px] text-muted-foreground">{c.completed} de {c.total} tareas</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
