import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Users, FolderKanban, AlertTriangle, ArrowRight } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { formatDateMX, nowMX } from "@/lib/dateUtils";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();

  const { data: tasks } = useQuery({
    queryKey: ["dashboard-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const activeClients = useMemo(
    () => clients?.filter((c) => c.status === "activo").length ?? 0,
    [clients]
  );
  const activeProjects = useMemo(
    () => projects?.filter((p) => p.status === "activo").length ?? 0,
    [projects]
  );
  const pendingTasks = tasks?.length ?? 0;

  const dueSoon = useMemo(() => {
    if (!tasks) return 0;
    const in7Days = nowMX();
    in7Days.setDate(in7Days.getDate() + 7);
    return tasks.filter(
      (t) => t.due_date && new Date(t.due_date) <= in7Days
    ).length;
  }, [tasks]);

  const myTasks = useMemo(
    () => tasks?.filter((t) => t.assigned_to === user?.id).slice(0, 5) ?? [],
    [tasks, user]
  );

  const stats = [
    { label: "Clientes activos", value: activeClients, icon: Users, color: "text-primary", href: "/clientes" },
    { label: "Tareas pendientes", value: pendingTasks, icon: CheckSquare, color: "text-accent-foreground", href: "/tareas" },
    { label: "Proyectos activos", value: activeProjects, icon: FolderKanban, color: "text-primary", href: "/proyectos" },
    { label: "Por vencer (7 días)", value: dueSoon, icon: AlertTriangle, color: "text-destructive", href: "/tareas" },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen general de Kawiil OS</p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(stat.href)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* My Tasks */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Mis tareas</CardTitle>
              <button
                onClick={() => navigate("/tareas")}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Ver todas <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent>
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No tienes tareas pendientes asignadas.
                </p>
              ) : (
                <div className="space-y-2">
                  {myTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm"
                    >
                      <span className="truncate flex-1">{t.title}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {t.due_date && (
                          <span className="text-xs text-muted-foreground">
                            {formatDateMX(t.due_date)}
                          </span>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {t.priority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent clients */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Clientes recientes</CardTitle>
              <button
                onClick={() => navigate("/clientes")}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Ver todos <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent>
              {!clients || clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin clientes registrados aún.
                </p>
              ) : (
                <div className="space-y-2">
                  {clients.slice(0, 5).map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/clientes/${c.id}`)}
                    >
                      <span className="truncate flex-1">{c.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          c.status === "activo"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {c.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
