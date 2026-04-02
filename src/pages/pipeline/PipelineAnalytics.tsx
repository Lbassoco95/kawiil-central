import { usePipelineStats } from "@/hooks/usePipeline";
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
  const { data, isLoading } = usePipelineStats(null, null);

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  const byStage = (data?.by_stage as Record<string, number> | undefined) || {};
  const chartData = Object.entries(byStage).map(([name, value]) => ({ name, value: Number(value) || 0 }));
  const newLeads = Number(data?.new_leads) || 0;
  const active = Number(data?.active_leads) || 0;
  const openRate = Number(data?.email_open_rate) || 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasa apertura email (aprox.)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(openRate * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}
