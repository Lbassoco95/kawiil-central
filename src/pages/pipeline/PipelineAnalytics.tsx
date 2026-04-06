import { usePipelineStats, usePipelineStages, usePipelineLeads, useAllTasks } from "@/hooks/usePipeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function PipelineAnalytics() {
  const { data, isLoading: statsLoading } = usePipelineStats(null, null);
  const { data: stages = [], isLoading: stagesLoading } = usePipelineStages();
  const { data: leads = [] } = usePipelineLeads(true);
  const { data: overdueTasks = [] } = useAllTasks("overdue");

  const isLoading = statsLoading || stagesLoading;

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  const byStage = (data?.by_stage as Record<string, number> | undefined) || {};
  const chartData = stages.map((s) => ({
    name: s.name,
    value: Number(byStage[s.slug]) || 0,
  }));
  const byCountryRaw = (data?.by_country as Record<string, number> | undefined) || {};
  const countryChartData = Object.entries(byCountryRaw)
    .map(([name, value]) => ({ name, value: Number(value) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 16);

  const emailReply = (data?.email_reply as Record<string, unknown> | undefined) || {};
  const replyContacted = Number(emailReply.contacted) || 0;
  const replyReplied = Number(emailReply.replied) || 0;
  const replyRate = Number(emailReply.reply_rate) || 0;
  const avgReplyHours = Number(emailReply.avg_reply_hours) || 0;
  const medianReplyHours = Number(emailReply.median_reply_hours) || 0;
  const replyHistogram = (Array.isArray(emailReply.histogram) ? emailReply.histogram : []) as {
    label?: string;
    count?: number;
  }[];
  const histogramChart = replyHistogram.map((h) => ({
    name: String(h.label ?? ""),
    value: Number(h.count) || 0,
  }));

  const newLeads = Number(data?.new_leads) || 0;
  const active = Number(data?.active_leads) || 0;
  const openRate = Number(data?.email_open_rate) || 0;

  // New metrics
  const registradoStage = stages.find((s) => s.slug === "registrado");
  const convertidoStage = stages.find((s) => s.slug === "convertido");
  const contactedCount = registradoStage
    ? leads.filter((l) => l.stage_id !== registradoStage.id).length
    : 0;
  const conversionRate = convertidoStage && leads.length > 0
    ? leads.filter((l) => l.stage_id === convertidoStage.id).length / leads.length
    : 0;

  // Stale leads (7+ days without activity)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const staleCount = leads.filter((l) => {
    const stage = stages.find((s) => s.id === l.stage_id);
    if (stage?.is_terminal) return false;
    const lastActivity = (l as Record<string, unknown>).last_activity_at as string | null;
    if (!lastActivity) return true;
    return new Date(lastActivity) < sevenDaysAgo;
  }).length;

  // Funnel data
  const funnelData = stages
    .filter((s) => !s.is_terminal)
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      name: s.name,
      count: leads.filter((l) => l.stage_id === s.id).length,
      color: s.color,
    }));
  const maxFunnel = Math.max(1, ...funnelData.map((f) => f.count));

  return (
    <div className="space-y-6">
      {/* Row 1: Original + new metrics */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Leads nuevos (30 días)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{newLeads}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Activos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasa apertura email</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(openRate * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contactados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{contactedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasa conversión</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(conversionRate * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Email reply metrics (primer outbound en el rango → primera respuesta inbound) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contactados (email saliente)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{replyContacted}</p>
            <p className="text-xs text-muted-foreground mt-1">En el periodo del filtro (30 días por defecto)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Respondieron</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{replyReplied}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasa de respuesta</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(replyRate * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tiempo a respuesta (mediana)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{medianReplyHours.toFixed(1)} h</p>
            <p className="text-xs text-muted-foreground mt-1">Media: {avgReplyHours.toFixed(1)} h</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Operational metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600">Tareas vencidas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{overdueTasks.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-600">Leads sin actividad 7+ días</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{staleCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">En Registrado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {registradoStage ? leads.filter((l) => l.stage_id === registradoStage.id).length : 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-h-[380px]">
          <CardHeader>
            <CardTitle>Leads por país</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              País del formulario, origen manual o código; activos en pipeline.
            </p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {countryChartData.length === 0 ? (
              <p className="text-muted-foreground text-sm">Sin datos de país</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={countryChartData}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={108}
                    tick={{ fontSize: 10 }}
                    interval={0}
                  />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-[380px]">
          <CardHeader>
            <CardTitle>Tiempo hasta primera respuesta</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Distribución (horas desde primer envío outbound hasta primer inbound en el mismo hilo).
            </p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {histogramChart.length === 0 || histogramChart.every((x) => x.value === 0) ? (
              <p className="text-muted-foreground text-sm">Sin respuestas registradas en el periodo</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramChart} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader>
          <CardTitle>Leads por etapa</CardTitle>
        </CardHeader>
        <CardContent className="h-[360px]">
          {chartData.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin datos aún</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" angle={-25} textAnchor="end" height={60} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Funnel visualization */}
      {funnelData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Embudo de conversión</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {funnelData.map((f) => (
                <div key={f.name} className="flex items-center gap-3">
                  <span className="text-sm w-28 text-right shrink-0 truncate">{f.name}</span>
                  <div className="flex-1 h-8 relative">
                    <div
                      className="h-full rounded-md transition-all flex items-center justify-end pr-3"
                      style={{
                        width: `${Math.max(8, (f.count / maxFunnel) * 100)}%`,
                        backgroundColor: f.color,
                        opacity: 0.85,
                      }}
                    >
                      <span className="text-xs font-medium text-white">{f.count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
