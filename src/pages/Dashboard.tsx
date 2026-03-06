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
} from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { formatDateMX, nowMX } from "@/lib/dateUtils";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();

  // All non-completed/cancelled tasks
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

  const activeClients = useMemo(
    () => clients?.filter((c) => c.status === "activo").length ?? 0,
    [clients]
  );
  const activeProjects = useMemo(
    () => projects?.filter((p) => p.status === "activo").length ?? 0,
    [projects]
  );

  const dueSoon = useMemo(() => {
    const in7Days = nowMX();
    in7Days.setDate(in7Days.getDate() + 7);
    return pendingTasks.filter(
      (t) => t.due_date && new Date(t.due_date) <= in7Days
    ).length;
  }, [pendingTasks]);

  // My tasks (assigned to me), sorted by due_date
  const myTasks = useMemo(
    () => pendingTasks.filter((t) => t.assigned_to === user?.id).slice(0, 8),
    [pendingTasks, user]
  );

  // ── Progress by project ──
  const projectProgress = useMemo(() => {
    if (!projects || !allTasks) return [];
    const activeProjs = projects.filter((p) => p.status === "activo");
    return activeProjs.map((p) => {
      const projectTasks = allTasks.filter((t) => t.project_id === p.id);
      const total = projectTasks.length;
      const completed = projectTasks.filter((t) => t.status === "completada").length;
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
    }).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [projects, allTasks]);

  // ── Progress by client ──
  const clientProgress = useMemo(() => {
    if (!clients || !allTasks) return [];
    const activeC = clients.filter((c) => c.status === "activo");
    return activeC.map((c) => {
      const clientTasks = allTasks.filter((t) => t.client_id === c.id);
      const total = clientTasks.length;
      const completed = clientTasks.filter((t) => t.status === "completada").length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { id: c.id, name: c.name, total, completed, pct };
    }).filter((c) => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [clients, allTasks]);

  // ── Area indicators ──
  const areaStats = useMemo(() => {
    if (!pendingTasks) return [];
    const areas: Record<string, { total: number; overdue: number }> = {};
    const today = nowMX();
    pendingTasks.forEach((t) => {
      const a = t.area || "sin_area";
      if (!areas[a]) areas[a] = { total: 0, overdue: 0 };
      areas[a].total++;
      if (t.due_date && new Date(t.due_date) < today) areas[a].overdue++;
    });
    return Object.entries(areas)
      .filter(([key]) => key !== "sin_area")
      .map(([key, val]) => ({
        area: key,
        label: SERVICE_LABELS[key as keyof typeof SERVICE_LABELS] || key,
        ...val,
        status: val.overdue > 0 ? "danger" : val.total > 5 ? "warning" : "ok",
      }))
      .sort((a, b) => b.total - a.total);
  }, [pendingTasks]);

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

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen operativo de Kawiil OS</p>
        </div>

        {/* Stats Row */}
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

        {/* Area Indicators */}
        {areaStats.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Estado por área
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {areaStats.map((a) => (
                  <div
                    key={a.area}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusDot(a.status)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{a.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.total} pendientes
                        {a.overdue > 0 && (
                          <span className="text-destructive ml-1">· {a.overdue} vencidas</span>
                        )}
                      </div>
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
                          <span className="text-[11px] text-muted-foreground">
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
                          <span className="text-[10px] text-muted-foreground block">
                            {p.completed}/{p.total}
                          </span>
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
                    <span className="text-[10px] text-muted-foreground">
                      {c.completed} de {c.total} tareas
                    </span>
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
