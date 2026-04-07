import { useMemo, useState } from "react";
import { TeamMonthlyPerformance } from "@/components/dashboard/TeamMonthlyPerformance";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { MetricInsight } from "@/components/dashboard/MetricInsight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CheckSquare,
  Users,
  FolderKanban,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { formatDateMX, nowMX } from "@/lib/dateUtils";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { useUserRole } from "@/hooks/useUserRole";

/** Separación entre llamadas IA en el mismo montaje (tabs pueden estar todas en DOM). */
const TEAM_AI_STAGGER_MS = 700;

const PROJECT_STATUS_LABEL: Record<string, string> = {
  activo: "Activo",
  pausado: "Pausado",
  completado: "Completado",
  cancelado: "Cancelado",
};

export function TeamDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [teamMemberSheetUserId, setTeamMemberSheetUserId] = useState<string | null>(null);
  const { isAdminOrManager } = useUserRole();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: orgUsers } = useOrgUsers();

  const { data: allTasks } = useQuery({
    queryKey: ["dashboard-all-tasks"],
    queryFn: async () => {
      // Incluye subtareas: el tablero /tareas filtra is_subtask; las métricas de equipo deben reflejar toda la carga.
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
      const assignedClients =
        clients
          ?.filter((c) => c.status === "activo" && c.responsible_user_id === u.user_id)
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name, "es")) ?? [];
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
        assignedClients,
      };
    })
      .filter((u) => u.total > 0 || u.assignedClients.length > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [orgUsers, allTasks, clients, user, today]);

  const sheetMemberCard = useMemo(
    () => (teamMemberSheetUserId ? teamWorkload.find((m) => m.userId === teamMemberSheetUserId) ?? null : null),
    [teamMemberSheetUserId, teamWorkload]
  );

  const memberClientsPortfolio = useMemo(() => {
    if (!teamMemberSheetUserId || !orgUsers) return null;
    const member = orgUsers.find((u) => u.user_id === teamMemberSheetUserId);
    if (!member) return null;

    const userNameById: Record<string, string> = {};
    orgUsers.forEach((u) => {
      userNameById[u.user_id] = u.full_name;
    });

    const safeClients = clients ?? [];
    const safeProjects = projects ?? [];
    const safeTasks = allTasks ?? [];

    const assignedList = safeClients
      .filter((c) => c.status === "activo" && c.responsible_user_id === teamMemberSheetUserId)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    const blocks = assignedList.map((client) => {
      const clientTasks = safeTasks.filter((t) => t.client_id === client.id);
      const cTotal = clientTasks.length;
      const cCompleted = clientTasks.filter((t) => t.status === "completada").length;
      const cPct = cTotal > 0 ? Math.round((cCompleted / cTotal) * 100) : 0;

      const clientProjects = safeProjects.filter((p) => p.client_id === client.id && p.status !== "cancelado");
      const projectRows = clientProjects
        .map((p) => {
          const pt = safeTasks.filter((t) => t.project_id === p.id);
          const total = pt.length;
          const completed = pt.filter((t) => t.status === "completada").length;
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          const rid = p.responsible_user_id;
          return {
            id: p.id,
            name: p.name,
            area: p.area,
            areaLabel:
              (p.area && SERVICE_LABELS[p.area as keyof typeof SERVICE_LABELS]) || p.area || "Sin área",
            pct,
            total,
            completed,
            responsibleUserId: rid,
            responsibleName: rid ? userNameById[rid] || "—" : "Sin asignar",
            status: p.status,
          };
        })
        .sort((a, b) => a.areaLabel.localeCompare(b.areaLabel, "es") || a.name.localeCompare(b.name, "es"));

      return {
        id: client.id,
        name: client.name,
        clientOverallPct: cPct,
        clientTotalTasks: cTotal,
        clientCompleted: cCompleted,
        projects: projectRows,
      };
    });

    return {
      memberName: member.full_name,
      memberArea: member.area,
      userId: teamMemberSheetUserId,
      blocks,
    };
  }, [teamMemberSheetUserId, orgUsers, clients, projects, allTasks]);

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

  const teamSummaryPrompt = useMemo(() => {
    const criticalProjects = projects?.filter((p: any) => p.criticality_level === "critico" || p.delay_category) ?? [];
    
    // Build project-specific context for active projects
    const activeProjectDetails = projects?.filter((p) => p.status === "activo").map((p: any) => {
      const pt = allTasks?.filter((t) => t.project_id === p.id) ?? [];
      const ptPending = pt.filter(t => ["pendiente", "en_progreso", "en_revision"].includes(t.status));
      const ptOverdue = ptPending.filter(t => t.due_date && new Date(t.due_date) < today);
      
      let areaDetail = "";
      
      // Lawsuit deadlines
      if (p.area === "juicios" && p.lawsuit_details) {
        const ld = p.lawsuit_details;
        const deadlines = Array.isArray(ld.deadlines) ? ld.deadlines : [];
        const upcoming = deadlines.filter((d: any) => !d.completed && d.date).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const overdueD = upcoming.filter((d: any) => new Date(d.date) < today);
        if (upcoming.length > 0) {
          areaDetail = ` | Próximas fechas: ${upcoming.slice(0, 2).map((d: any) => `${d.title} (${d.date})`).join(", ")}`;
          if (overdueD.length > 0) areaDetail += ` ⚠️ ${overdueD.length} vencidas`;
        }
      }
      
      // Constitution/Gestoría progress
      if ((p.area === "softlanding" || p.area === "constitucion_nacional" || p.area === "gestoria") && p.constitution_details) {
        const phases = Array.isArray(p.constitution_details.phases) ? p.constitution_details.phases : [];
        const allSteps = phases.flatMap((ph: any) => Array.isArray(ph.steps) ? ph.steps : []);
        const done = allSteps.filter((s: any) => s.completed).length;
        if (allSteps.length > 0) areaDetail = ` | Pasos: ${done}/${allSteps.length}`;
      }
      
      return `  - ${p.name} (${SERVICE_LABELS[p.area as keyof typeof SERVICE_LABELS] || p.area || "sin área"}) — ${ptPending.length} pendientes, ${ptOverdue.length} vencidas${areaDetail}`;
    }) ?? [];

    return `Genera un resumen ejecutivo breve del estado del equipo Kawiil para el dashboard. Usa español mexicano, tono profesional y cercano con emojis.

DATOS:
- Clientes activos: ${activeClients}
- Proyectos activos: ${activeProjects}
- Tareas pendientes totales: ${pendingTasks.length}
- Tareas completadas: ${completedTasks.length}
- Por vencer en 7 días: ${dueSoon}

AVANCE POR CÉLULA:
${areaStats.map(a => `- ${a.label}: ${a.pct}% completado (${a.pending} pendientes, ${a.overdue} vencidas)`).join("\n")}

PROYECTOS ACTIVOS CON DETALLE:
${activeProjectDetails.slice(0, 10).join("\n") || "Ninguno"}

PROYECTOS CRÍTICOS O CON ATRASO:
${criticalProjects.length > 0 ? criticalProjects.map((p: any) => `- ${p.name}: criticidad=${(p as any).criticality_level || "normal"}, motivo_atraso=${(p as any).delay_category || "ninguno"}`).join("\n") : "Ninguno"}

INSTRUCCIONES:
1. Resume en 3-5 puntos con emojis el estado general del equipo.
2. Destaca células con mejor desempeño y las que necesitan atención.
3. Si hay proyectos con audiencias o fechas clave próximas, menciónalos.
4. Si hay proyectos críticos o con atraso, menciónalos con contexto.
5. Si hay muchas tareas vencidas en alguna célula, sugiere acción.
6. Cierra con una observación motivadora.
7. Máximo 150 palabras. Usa Markdown: títulos con ## o ** (ej. **📊 Resumen ejecutivo**, **Estado general**), listas con guiones, **negritas** en cifras y alertas, emojis en viñetas.`;
  }, [activeClients, activeProjects, pendingTasks, completedTasks, dueSoon, areaStats, projects, allTasks, today]);

  const tabClass = "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap";

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <button
            key={stat.label}
            onClick={() => navigate(stat.href)}
            className={`stat-card flex items-center gap-3 text-left relative overflow-hidden animate-fade-in ${
              stat.highlight ? "border-destructive/20" : ""
            }`}
            style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          >
            <div className={`absolute inset-0 opacity-[0.05] bg-gradient-to-br ${stat.highlight ? "from-destructive to-destructive/50" : "from-primary to-accent"}`} />
            <div className={`relative h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
              stat.highlight ? "bg-destructive/10" : "bg-primary/10"
            }`}>
              <stat.icon className={`h-4.5 w-4.5 ${stat.highlight ? "text-destructive" : "text-primary"}`} />
            </div>
            <div className="relative min-w-0">
              <div className="text-2xl font-bold text-foreground leading-none animate-count-up">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1 font-medium">{stat.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumen" className="w-full min-w-0">
        <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-full justify-start border-b border-border bg-transparent rounded-none h-auto p-0 gap-0">
            <TabsTrigger value="resumen" className={tabClass}>Resumen</TabsTrigger>
            <TabsTrigger value="celulas" className={tabClass}>Células</TabsTrigger>
            {isAdminOrManager && (
              <TabsTrigger value="equipo" className={tabClass}>Equipo</TabsTrigger>
            )}
            <TabsTrigger value="proyectos" className={tabClass}>Proyectos</TabsTrigger>
            <TabsTrigger value="clientes" className={tabClass}>Clientes</TabsTrigger>
            <TabsTrigger value="tareas" className={tabClass}>Mis Tareas</TabsTrigger>
            {isAdminOrManager && (
              <TabsTrigger value="rendimiento" className={tabClass}>Rendimiento</TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Resumen */}
        <TabsContent value="resumen" className="mt-6 space-y-6 animate-fade-in">
          <AISummaryCard
            cacheKey={`team-dashboard-${user?.id}`}
            contextPrompt={teamSummaryPrompt}
            title="Resumen del equipo — Kawiil AI"
            ready={!!allTasks && !!projects}
            userId={user?.id}
          />

          {/* Quick area overview */}
          {areaStats.length > 0 && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {areaStats.slice(0, 8).map((a) => (
                <button
                  key={a.area}
                  onClick={() => navigate(`/tareas?area=${a.area}`)}
                  className="rounded-xl bg-secondary/30 p-3 text-left hover:ring-1 hover:ring-primary/30 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot(a.status)}`} />
                    <span className="text-[13px] font-medium text-foreground truncate">{a.label}</span>
                    <span className={`text-[13px] font-semibold ml-auto ${progressColor(a.pct)}`}>{a.pct}%</span>
                  </div>
                  <Progress value={a.pct} className="h-1" />
                </button>
              ))}
            </div>
          )}

          {/* Quick tasks */}
          {myTasks.length > 0 && (
            <div>
              <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Tus próximas tareas</h3>
              <div className="divide-y divide-border/40">
                {myTasks.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    className="flex items-center gap-3 w-full py-2 text-left hover:bg-secondary/30 -mx-2 px-2 rounded-md transition-colors"
                    onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                  >
                    <span className="text-sm text-foreground truncate flex-1">{t.title}</span>
                    {t.due_date && (
                      <span className={`text-[11px] shrink-0 ${new Date(t.due_date) < today ? "text-destructive" : "text-muted-foreground"}`}>
                        {formatDateMX(t.due_date)}
                      </span>
                    )}
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityColor(t.priority)}`}>
                      {t.priority}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Células */}
        <TabsContent value="celulas" className="mt-6 animate-fade-in">
          {areaStats.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Sin datos de células</p>
          ) : (
            <>
              <MetricInsight
                metricKey="area-stats"
                ready={areaStats.length > 0}
                requestDelayMs={TEAM_AI_STAGGER_MS * 1}
                contextPrompt={`Eres el analista de un despacho contable/legal. Analiza estos datos de avance por célula y da UNA recomendación accionable (máximo 45 palabras).

Datos: ${areaStats.map(a => `${a.label}: ${a.pct}% avance, ${a.overdue} vencidas, ${a.pending} pendientes`).join("; ")}

Formato obligatorio: Markdown. Usa **negritas** para el hallazgo principal; viñetas si hay varios puntos; 1-2 emojis opcionales. Sin saludo ni despedida.`}
              />
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-4">
                {areaStats.map((a) => (
                  <button
                    key={a.area}
                    onClick={() => navigate(`/tareas?area=${a.area}`)}
                    className="rounded-xl bg-secondary/30 p-4 card-hover text-left cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot(a.status)}`} />
                        <span className="text-[13px] font-medium text-foreground">{a.label}</span>
                      </div>
                      <span className={`text-[13px] font-semibold ${progressColor(a.pct)}`}>{a.pct}%</span>
                    </div>
                    <Progress value={a.pct} className="h-1 mb-2.5" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>{a.completed} completadas</span>
                      <span>{a.pending} pendientes</span>
                      {a.overdue > 0 && <span className="text-destructive font-medium">{a.overdue} vencidas</span>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* Equipo (admin only) */}
        {isAdminOrManager && (
          <TabsContent value="equipo" className="mt-6">
            {teamWorkload.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6">Sin datos del equipo</p>
            ) : (
              <>
                <MetricInsight
                  metricKey="team-workload"
                  ready={teamWorkload.length > 0}
                  requestDelayMs={TEAM_AI_STAGGER_MS * 2}
                  contextPrompt={`Eres el analista de un despacho. Analiza la carga de trabajo y da UNA recomendación accionable (máximo 50 palabras).

Datos: ${teamWorkload.slice(0, 5).map((m) => `${m.name}: ${m.pending} pendientes, ${m.overdue} vencidas${m.assignedClients.length ? `; clientes: ${m.assignedClients.map((c) => c.name).join(", ")}` : ""}`).join("; ")}

Formato obligatorio: Markdown. **Negritas** para alertas o acciones clave; viñetas si listas varias personas o acciones; emojis opcionales (ej. ⚠️ 🔥). Sin saludo.`}
                />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-4">
                  {teamWorkload.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => setTeamMemberSheetUserId(m.userId)}
                      className={`rounded-xl p-4 card-hover text-left cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all ${
                        m.overdue > 0 ? "bg-destructive/5 border border-destructive/10" : m.pending > 8 ? "bg-warning/5 border border-warning/10" : "bg-secondary/30 border border-transparent"
                      } ${m.isMe ? "ring-1 ring-primary/20" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <div className="min-w-0 flex-1 mr-2">
                          <span className="text-[13px] font-medium text-foreground block truncate">
                            {m.name}
                            {m.isMe && <span className="text-[10px] text-primary ml-1">(tú)</span>}
                          </span>
                          {m.area && <span className="text-[10px] text-muted-foreground">{m.area}</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[13px] font-semibold ${progressColor(m.pct)}`}>{m.pct}%</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                        </div>
                      </div>
                      <Progress value={m.pct} className="h-1 mb-2" />
                      <div className="flex gap-3 text-[11px] text-muted-foreground">
                        <span>{m.pending} pendientes</span>
                        <span>{m.completed} hechas</span>
                        {m.overdue > 0 && <span className="text-destructive font-medium">{m.overdue} vencidas</span>}
                      </div>
                      <p className="text-[10px] text-primary font-medium mt-2">Ver clientes y avance por proyecto</p>
                      <div className="mt-2 pt-2 border-t border-border/50 text-left">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                          Clientes como responsable
                        </p>
                        {m.assignedClients.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {m.assignedClients.slice(0, 5).map((c) => (
                              <Badge
                                key={c.id}
                                variant="outline"
                                className="text-[10px] font-normal max-w-full truncate px-1.5 py-0 h-5"
                                title={c.name}
                              >
                                {c.name}
                              </Badge>
                            ))}
                            {m.assignedClients.length > 5 && (
                              <span className="text-[10px] text-muted-foreground self-center">
                                +{m.assignedClients.length - 5}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Ninguno en ficha de cliente</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        )}

        {/* Proyectos */}
        <TabsContent value="proyectos" className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Avance de proyectos</h3>
            <button
              onClick={() => navigate("/proyectos")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <MetricInsight
            metricKey="project-progress"
            ready={projectProgress.length > 0}
            requestDelayMs={TEAM_AI_STAGGER_MS * 3}
            contextPrompt={`Eres el analista de un despacho. Analiza el avance de proyectos y da UNA recomendación accionable (máximo 45 palabras).

Datos: ${projectProgress.slice(0, 5).map(p => `${p.clientName} (${p.name}): ${p.pct}%`).join("; ")}

Markdown obligatorio: **negritas** para prioridades; viñetas si hay varios proyectos; emojis opcionales. Sin saludo.`}
          />
          {projectProgress.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Sin proyectos activos</p>
          ) : (
            <div className="space-y-px mt-4">
              {projectProgress.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left rounded-lg p-3 hover:bg-secondary/60 transition-colors"
                  onClick={() => navigate(`/proyectos/${p.id}`)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0 flex-1 mr-3">
                      <span className="text-[13px] font-medium text-foreground truncate block">{p.clientName}</span>
                      <span className="text-xs text-muted-foreground truncate block">{p.name}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-[13px] font-semibold ${progressColor(p.pct)}`}>{p.pct}%</span>
                      <span className="text-[10px] text-muted-foreground block">{p.completed}/{p.total}</span>
                    </div>
                  </div>
                  <Progress value={p.pct} className="h-1" />
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Clientes */}
        <TabsContent value="clientes" className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Avance por cliente</h3>
            <button
              onClick={() => navigate("/clientes")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <MetricInsight
            metricKey="client-progress"
            ready={clientProgress.length > 0}
            requestDelayMs={TEAM_AI_STAGGER_MS * 4}
            contextPrompt={`Eres el analista de un despacho. Analiza el avance por cliente y da UNA recomendación accionable (máximo 45 palabras).

Datos: ${clientProgress.slice(0, 5).map(c => `${c.name}: ${c.pct}% (${c.total - c.completed} pendientes)`).join("; ")}

Markdown: **negritas** para riesgo o acción; viñetas si varios clientes; emojis opcionales. Sin saludo.`}
          />
          {clientProgress.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Sin datos de clientes</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
              {clientProgress.map((c) => (
                <button
                  key={c.id}
                  className="text-left rounded-xl bg-secondary/30 p-4 hover:bg-secondary/50 transition-colors"
                  onClick={() => navigate(`/clientes/${c.id}`)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-medium text-foreground truncate flex-1 mr-2">{c.name}</span>
                    <span className={`text-[13px] font-semibold ${progressColor(c.pct)}`}>{c.pct}%</span>
                  </div>
                  <Progress value={c.pct} className="h-1 mb-1.5" />
                  <span className="text-[10px] text-muted-foreground">{c.completed} de {c.total} tareas</span>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Mis Tareas */}
        <TabsContent value="tareas" className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Mis tareas pendientes</h3>
            <button
              onClick={() => navigate("/tareas")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Ver todas <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {myTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Sin tareas pendientes 🎉</p>
          ) : (
            <div className="space-y-px">
              {myTasks.map((t) => (
                <button
                  key={t.id}
                  className="flex items-center justify-between w-full rounded-lg px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-left"
                  onClick={() => navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)}
                >
                  <span className="truncate flex-1 mr-3 text-foreground">{t.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.due_date && (
                      <span className={`text-[11px] ${new Date(t.due_date) < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {formatDateMX(t.due_date)}
                      </span>
                    )}
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityColor(t.priority)}`}>
                      {t.priority}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Rendimiento (admin only) */}
        {isAdminOrManager && (
          <TabsContent value="rendimiento" className="mt-6">
            <TeamMonthlyPerformance />
          </TabsContent>
        )}
      </Tabs>

      <Sheet open={!!teamMemberSheetUserId} onOpenChange={(open) => !open && setTeamMemberSheetUserId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
          {teamMemberSheetUserId && !memberClientsPortfolio && (
            <div className="p-6 text-sm text-muted-foreground">Cargando portafolio…</div>
          )}
          {memberClientsPortfolio && (
            <>
              <SheetHeader className="p-6 pb-4 border-b border-border/60 text-left space-y-1">
                <SheetTitle className="pr-8">{memberClientsPortfolio.memberName}</SheetTitle>
                <SheetDescription className="text-left space-y-1">
                  {memberClientsPortfolio.memberArea && (
                    <span className="block text-xs">Célula: {memberClientsPortfolio.memberArea}</span>
                  )}
                  {sheetMemberCard && (
                    <span className="block text-xs text-muted-foreground">
                      Tareas: {sheetMemberCard.pending} pendientes · {sheetMemberCard.completed} completadas
                      {sheetMemberCard.overdue > 0 && (
                        <span className="text-destructive font-medium"> · {sheetMemberCard.overdue} vencidas</span>
                      )}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground pt-1">
                    Clientes donde esta persona es responsable en la ficha del cliente, con todos los proyectos no
                    cancelados y el responsable de cada proyecto.
                  </span>
                </SheetDescription>
              </SheetHeader>

              <ScrollArea className="flex-1 min-h-0 max-h-[calc(100dvh-11rem)] px-6">
                <div className="py-4 space-y-6">
                  {memberClientsPortfolio.blocks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No hay clientes activos con esta persona como responsable. Asígnala en la ficha del cliente
                      (campo responsable) para ver el portafolio aquí.
                    </p>
                  ) : (
                    memberClientsPortfolio.blocks.map((block) => (
                      <div key={block.id} className="rounded-xl border border-border/60 bg-secondary/20 overflow-hidden">
                        <div className="p-3 border-b border-border/40 bg-secondary/40">
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => {
                              setTeamMemberSheetUserId(null);
                              navigate(`/clientes/${block.id}`);
                            }}
                          >
                            <span className="text-sm font-semibold text-foreground hover:text-primary flex items-center gap-1">
                              {block.name}
                              <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                            </span>
                          </button>
                          <div className="flex items-center justify-between mt-2 gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              Avance global de tareas del cliente
                            </span>
                            <span className={`text-xs font-semibold shrink-0 ${progressColor(block.clientOverallPct)}`}>
                              {block.clientOverallPct}%
                            </span>
                          </div>
                          <Progress value={block.clientOverallPct} className="h-1 mt-1.5" />
                          <span className="text-[10px] text-muted-foreground mt-1 block">
                            {block.clientCompleted} de {block.clientTotalTasks} tareas con este cliente
                          </span>
                        </div>
                        <div className="p-3 space-y-2">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Proyectos por área
                          </p>
                          {block.projects.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Sin proyectos (excl. cancelados) para este cliente.
                            </p>
                          ) : (
                            block.projects.map((proj) => (
                              <button
                                key={proj.id}
                                type="button"
                                className="w-full text-left rounded-lg border border-border/50 bg-background/80 p-2.5 hover:bg-secondary/50 transition-colors"
                                onClick={() => {
                                  setTeamMemberSheetUserId(null);
                                  navigate(`/proyectos/${proj.id}`);
                                }}
                              >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="min-w-0">
                                    <Badge variant="secondary" className="text-[10px] font-normal mb-1">
                                      {proj.areaLabel}
                                    </Badge>
                                    <p className="text-[12px] font-medium text-foreground truncate">{proj.name}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className={`text-xs font-semibold ${progressColor(proj.pct)}`}>
                                      {proj.pct}%
                                    </span>
                                    <span className="text-[10px] text-muted-foreground block">
                                      {proj.completed}/{proj.total} tareas
                                    </span>
                                  </div>
                                </div>
                                <Progress value={proj.pct} className="h-1 mb-1.5" />
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span>
                                    Resp. proyecto:{" "}
                                    <span className="text-foreground font-medium">{proj.responsibleName}</span>
                                  </span>
                                  {proj.status !== "activo" && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-normal">
                                      {PROJECT_STATUS_LABEL[proj.status] || proj.status}
                                    </Badge>
                                  )}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <SheetFooter className="p-4 border-t border-border/60 flex-col sm:flex-col gap-2">
                {sheetMemberCard && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      const area = sheetMemberCard.area;
                      setTeamMemberSheetUserId(null);
                      navigate(area ? `/tareas?area=${area}` : "/tareas");
                    }}
                  >
                    Ir a tareas {sheetMemberCard.area ? `(${sheetMemberCard.area})` : "del equipo"}
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
