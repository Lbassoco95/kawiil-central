import { useCallback, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import ReactMarkdown from "react-markdown";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Expense } from "@/hooks/useExpenses";
import type { Client } from "@/hooks/useClients";
import { useFinanceIntelligenceData } from "@/hooks/useFinanceIntelligenceData";
import {
  type FinanceLocalDateRange,
  type FinancePeriodPreset,
  resolveFinanceRange,
  resolvePreviousComparableRange,
} from "@/lib/financePeriodRange";
import { invokeAiFinanceInsights } from "@/lib/aiFinanceInsightsInvoke";
import { getSavioAppPanelUrl } from "@/lib/savioAppUrl";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { savioFinanceApiFailureHint } from "@/lib/savioFinanceApiHints";
import { SAVIO_FINANCE_PAGE_BOOST_STEP } from "@/lib/savioFinancePagedFetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function formatRangeLabel(r: FinanceLocalDateRange) {
  return `${format(r.start, "d MMM yyyy", { locale: es })} – ${format(r.end, "d MMM yyyy", { locale: es })}`;
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const PRESET_OPTIONS: { value: FinancePeriodPreset; label: string }[] = [
  { value: "month", label: "Mes" },
  { value: "bimonth", label: "Bimestre" },
  { value: "quarter", label: "Trimestre" },
  { value: "semester", label: "Semestre" },
  { value: "year", label: "Año" },
  { value: "custom", label: "Rango personalizado" },
];

function serviceLabel(s: string): string {
  const k = s as ServiceArea;
  return SERVICE_LABELS[k] ?? s;
}

function reminderText(row: { folio: string; cliente: string; monto: number | null; daysOverdue: number | null }) {
  const m = row.monto != null ? formatMoney(row.monto) : "importe pendiente";
  const atraso =
    row.daysOverdue != null && row.daysOverdue > 0
      ? ` (${row.daysOverdue} día${row.daysOverdue === 1 ? "" : "s"} de atraso)`
      : "";
  return (
    `Estimado cliente de ${row.cliente},\n\n` +
    `Les recordamos el seguimiento del cargo/factura ${row.folio} por un monto de ${m}${atraso}. ` +
    `Quedamos atentos a cualquier comentario o comprobante de pago.\n\n` +
    `Saludos cordiales,\nKawiil`
  );
}

type Props = {
  expenses: Expense[];
  clients: Client[];
  savioEnabled?: boolean;
};

export function FinanceIntelligenceBoards({ expenses, clients, savioEnabled = true }: Props) {
  const [preset, setPreset] = useState<FinancePeriodPreset>("month");
  const [anchorYmd, setAnchorYmd] = useState(() => ymdLocal(new Date()));
  const [customFrom, setCustomFrom] = useState(() => ymdLocal(new Date()));
  const [customTo, setCustomTo] = useState(() => ymdLocal(new Date()));
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMarkdown, setAiMarkdown] = useState<string | null>(null);

  const anchorDate = useMemo(() => parseYmdLocal(anchorYmd) ?? new Date(), [anchorYmd]);
  const customRange = useMemo((): FinanceLocalDateRange | null => {
    if (preset !== "custom") return null;
    const a = parseYmdLocal(customFrom);
    const b = parseYmdLocal(customTo);
    if (!a || !b) return null;
    return { start: a, end: b };
  }, [preset, customFrom, customTo]);

  const primaryRange = useMemo(() => {
    return resolveFinanceRange({
      preset,
      anchor: anchorDate,
      custom: customRange ?? undefined,
    });
  }, [preset, anchorDate, customRange]);

  const compareRange = useMemo(() => {
    if (!compareEnabled) return null;
    return resolvePreviousComparableRange(primaryRange, preset);
  }, [compareEnabled, primaryRange, preset]);

  const intelligence = useFinanceIntelligenceData(primaryRange, compareRange, expenses, clients, {
    enableSavio: savioEnabled,
  });

  const savioHint = savioFinanceApiFailureHint(intelligence.savioError ?? undefined);

  const compareChartData = useMemo(() => {
    if (!compareRange) return [];
    return [
      {
        name: "Periodo actual",
        Cobrado: intelligence.primaryCollected.sum,
        "Gastos pagados": intelligence.primaryExpenses.sum,
        Facturado: intelligence.primaryInvoiced.sum,
      },
      {
        name: "Periodo anterior",
        Cobrado: intelligence.compareCollected.sum,
        "Gastos pagados": intelligence.compareExpenses.sum,
        Facturado: intelligence.compareInvoiced.sum,
      },
    ];
  }, [compareRange, intelligence]);

  const buildSnapshot = useCallback(() => {
    const topAnon = intelligence.payerRankPrimary.slice(0, 10).map((r, i) => ({
      etiqueta: `Cliente_${i + 1}`,
      cobrado_mxn: Math.round(r.sum * 100) / 100,
      pagos: r.count,
    }));
    return {
      periodo_etiqueta: formatRangeLabel(primaryRange),
      datos_truncados: intelligence.truncated,
      ingresos_cobrados_mxn: Math.round(intelligence.primaryCollected.sum * 100) / 100,
      gastos_pagados_mxn: Math.round(intelligence.primaryExpenses.sum * 100) / 100,
      facturado_mxn: Math.round(intelligence.primaryInvoiced.sum * 100) / 100,
      cartera_pendiente_mxn: Math.round(intelligence.portfolio.sum * 100) / 100,
      facturas_con_saldo_count: intelligence.portfolio.count,
      facturas_vencidas_count: intelligence.overdue.length,
      facturas_proximas_vencer_count: intelligence.upcoming.length,
      clientes_kawiil_multi_servicio_count: intelligence.multiServiceClients.length,
      margen_operativo_aprox: intelligence.ratios.approxOperatingMargin,
      presion_cartera_vs_cobrado: intelligence.ratios.portfolioPressureVsCollected,
      concentracion_top5_en_cobros: intelligence.ratios.topClientsShareOfCollected,
      top_clientes_anonimizados: topAnon,
      comparacion_periodo_anterior: compareRange
        ? {
            ingresos_cobrados_mxn: Math.round(intelligence.compareCollected.sum * 100) / 100,
            gastos_pagados_mxn: Math.round(intelligence.compareExpenses.sum * 100) / 100,
          }
        : null,
      nota_metodologia:
        "Ingresos por fecha de pago Savio; gastos por fecha de pago interno; cartera = facturas valid con saldo. No incluye balance general ni flujo de caja bancario.",
    };
  }, [primaryRange, compareRange, intelligence]);

  const runAi = async () => {
    setAiLoading(true);
    setAiMarkdown(null);
    try {
      const { data, error } = await invokeAiFinanceInsights(buildSnapshot());
      if (error) {
        toast.error(error.message || "No se pudo invocar el análisis");
        return;
      }
      if (!data) {
        toast.error("Respuesta vacía");
        return;
      }
      if ("skip" in data && data.skip === "no_anthropic") {
        toast.message("IA no configurada", {
          description: "Falta ANTHROPIC_API_KEY en Edge Functions.",
        });
        return;
      }
      if (data.ok === false) {
        toast.error((data as { error?: string }).error || "Error del modelo");
        return;
      }
      if (data.ok && data.markdown) {
        setAiMarkdown(data.markdown);
        setAiOpen(true);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const savioBase = getSavioAppPanelUrl();

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card className="border-border/50 bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              Periodo y comparación
            </CardTitle>
            <CardDescription>
              Los totales usan la misma lógica que el resumen: cobros por fecha de pago Savio y gastos internos por
              fecha de pago.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Vista</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as FinancePeriodPreset)}>
                <SelectTrigger className="h-9 w-[180px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {preset !== "custom" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha de referencia</Label>
                <Input
                  type="date"
                  value={anchorYmd}
                  onChange={(e) => setAnchorYmd(e.target.value)}
                  className="h-9 w-[160px] text-xs"
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-9 w-[160px] text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-9 w-[160px] text-xs"
                  />
                </div>
              </>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={compareEnabled} onCheckedChange={(c) => setCompareEnabled(c === true)} />
              Comparar con periodo anterior
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={() => void intelligence.refetch()}
              disabled={intelligence.isLoading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", intelligence.isLoading && "animate-spin")} />
              Actualizar datos
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">{formatRangeLabel(primaryRange)}</p>
        {compareRange && (
          <p className="text-xs text-muted-foreground">Comparación: {formatRangeLabel(compareRange)}</p>
        )}

        {intelligence.truncated && (
          <Alert variant="default" className="border-amber-500/40 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Datos parciales</AlertTitle>
            <AlertDescription className="text-xs">
              Savio devolvió un volumen alto de registros; los rankings reflejan solo lo cargado. Puedes cargar más
              páginas (+{SAVIO_FINANCE_PAGE_BOOST_STEP} por clic) o subir{" "}
              <code className="rounded bg-muted px-1">VITE_SAVIO_FINANCE_MAX_PAGES</code> en build.
            </AlertDescription>
          </Alert>
        )}

        {savioHint && (
          <Alert variant="destructive">
            <AlertTitle>Savio</AlertTitle>
            <AlertDescription className="text-xs">{savioHint}</AlertDescription>
          </Alert>
        )}

        {intelligence.reactQueryError && !savioHint && (
          <Alert variant="destructive">
            <AlertTitle>Error de red</AlertTitle>
            <AlertDescription className="text-xs">
              {(intelligence.reactQueryError as Error).message}
            </AlertDescription>
          </Alert>
        )}

        {intelligence.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Kpi
              title="Cobrado (periodo)"
              value={formatMoney(intelligence.primaryCollected.sum)}
              hint={`${intelligence.primaryCollected.count} pagos`}
            />
            <Kpi
              title="Gastos pagados"
              value={formatMoney(intelligence.primaryExpenses.sum)}
              hint={`${intelligence.primaryExpenses.count} registros`}
            />
            <Kpi
              title="Facturado (emisión)"
              value={formatMoney(intelligence.primaryInvoiced.sum)}
              hint={`${intelligence.primaryInvoiced.count} cargos`}
            />
            <Kpi
              title="Cartera pendiente"
              value={formatMoney(intelligence.portfolio.sum)}
              hint={`${intelligence.portfolio.count} facturas con saldo`}
            />
          </div>
        )}

        <Card className="border-border/50 bg-card/90">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Indicadores (aproximados)</CardTitle>
            <CardDescription className="text-xs">
              Calculados solo con cobros Savio, gastos internos pagados y cartera abierta en facturas{" "}
              <code className="rounded bg-muted px-0.5">valid</code> con saldo. No sustituyen estados financieros ni
              liquidez real.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <RatioTile
              label="Margen operativo aprox."
              formula="(Cobrado − Gastos pagados) ÷ Cobrado"
              value={
                intelligence.ratios.approxOperatingMargin != null
                  ? `${(intelligence.ratios.approxOperatingMargin * 100).toFixed(1)} %`
                  : "N/D"
              }
              foot="Útil para ver si el periodo cubre gastos operativos con lo cobrado; no incluye impuestos ni nómina fuera de solicitudes."
            />
            <RatioTile
              label="Presión de cartera vs cobrado"
              formula="Cartera pendiente ÷ Cobrado del periodo"
              value={
                intelligence.ratios.portfolioPressureVsCollected != null
                  ? `${intelligence.ratios.portfolioPressureVsCollected.toFixed(2)}×`
                  : "N/D"
              }
              foot="Indica cuántas veces la cartera vigente equivale a lo cobrado en el periodo; valores altos sugieren seguir cobranza."
            />
            <RatioTile
              label="Concentración (top 5 cobros)"
              formula="Suma top 5 clientes ÷ Cobrado del periodo"
              value={
                intelligence.ratios.topClientsShareOfCollected != null
                  ? `${(intelligence.ratios.topClientsShareOfCollected * 100).toFixed(1)} %`
                  : "N/D"
              }
              foot="Participación de los cinco mayores cobradores en el periodo; depende de que los pagos traigan cliente identificable."
            />
          </CardContent>
        </Card>

        {compareChartData.length > 0 && (
          <Card className="border-border/50 bg-card/90">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart3 className="h-4 w-4" />
                Ingresos cobrados vs gastos vs facturado
              </CardTitle>
            </CardHeader>
            <CardContent className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compareChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{ fontSize: 12, borderRadius: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Cobrado" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Gastos pagados" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Facturado" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1.5 text-xs"
            onClick={() => void runAi()}
            disabled={aiLoading || intelligence.isLoading}
          >
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Briefing con IA (Claude)
          </Button>
          {intelligence.canLoadMoreSavioPages && (
            <Button type="button" size="sm" variant="outline" className="text-xs" onClick={intelligence.loadMoreSavioPages}>
              Cargar más Savio (+{SAVIO_FINANCE_PAGE_BOOST_STEP} págs.)
            </Button>
          )}
        </div>

        <Collapsible open={aiOpen} onOpenChange={setAiOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", aiOpen && "rotate-180")} />
              {aiMarkdown ? "Ver briefing IA" : "Briefing IA (sin contenido aún)"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {aiMarkdown ? (
              <Card className="mt-2 border-border/50 bg-muted/20">
                <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4 text-sm">
                  <ReactMarkdown>{aiMarkdown}</ReactMarkdown>
                </CardContent>
              </Card>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Genera un resumen con el botón superior; los nombres de clientes en el JSON enviado a la IA van
                anonimizados (Cliente_1, …).
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Quién más cobró en el periodo" description="Agrupación por cliente en pagos Savio.">
            <DataTable
              empty="Sin pagos en el periodo o sin cliente identificable en los datos cargados."
              rows={intelligence.payerRankPrimary.slice(0, 25).map((r) => ({
                a: r.displayName,
                b: formatMoney(r.sum),
                c: String(r.count),
              }))}
              heads={["Cliente", "Cobrado", "Pagos"]}
            />
          </SectionCard>

          <SectionCard
            title="Clientes Kawiil con más de un servicio"
            description="Según `services` en la ficha del cliente."
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {intelligence.multiServiceClients.length} clientes
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs">Servicios</TableHead>
                  <TableHead className="text-xs w-[100px]">Savio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intelligence.multiServiceClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-xs text-muted-foreground">
                      Ningún cliente con más de un servicio.
                    </TableCell>
                  </TableRow>
                ) : (
                  intelligence.multiServiceClients.slice(0, 40).map((c) => (
                    <TableRow key={c.clientId}>
                      <TableCell className="text-xs font-medium">
                        <Link to={`/clientes/${c.clientId}`} className="text-primary hover:underline">
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[200px] text-xs text-muted-foreground">
                        {c.services.map(serviceLabel).join(", ")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.savioCustomerId ? (
                          <span className="text-emerald-600">Enlazado</span>
                        ) : (
                          <span className="text-amber-600">Sin Savio</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SectionCard>
        </div>

        <SectionCard
          title="Cobros vencidos y próximos a vencer"
          description="Facturas abiertas con fecha de vencimiento: atrasadas o en los próximos 7 días."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">Vencidas</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Cliente / Folio</TableHead>
                    <TableHead className="text-xs text-right">Días</TableHead>
                    <TableHead className="text-xs w-[90px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {intelligence.overdue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-xs text-muted-foreground">
                        Sin facturas vencidas con fecha de vencimiento en los datos.
                      </TableCell>
                    </TableRow>
                  ) : (
                    intelligence.overdue.slice(0, 30).map((row) => (
                      <TableRow key={row.invoiceId}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{row.cliente}</div>
                          <div className="text-muted-foreground">{row.folio}</div>
                          <div className="tabular-nums">{row.monto != null ? formatMoney(row.monto) : "—"}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {row.daysOverdue ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Copiar recordatorio"
                              onClick={() => {
                                void navigator.clipboard.writeText(reminderText(row));
                                toast.success("Texto copiado");
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            {savioBase && looksLikeSavioId(row.invoiceId) && (
                              <a
                                href={`${savioBase.replace(/\/$/, "")}/invoice/${encodeURIComponent(row.invoiceId)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex justify-center text-muted-foreground hover:text-foreground"
                                title="Abrir en Savio"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                Próximos 7 días
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Cliente / Folio</TableHead>
                    <TableHead className="text-xs text-right">Días</TableHead>
                    <TableHead className="text-xs w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {intelligence.upcoming.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-xs text-muted-foreground">
                        Sin vencimientos en la ventana.
                      </TableCell>
                    </TableRow>
                  ) : (
                    intelligence.upcoming.map((row) => (
                      <TableRow key={row.invoiceId}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{row.cliente}</div>
                          <div className="text-muted-foreground">{row.folio}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs">{row.daysUntilDue ?? "—"}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              void navigator.clipboard.writeText(reminderText({ ...row, daysOverdue: null }));
                              toast.success("Texto copiado");
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </SectionCard>
      </div>
    </TooltipProvider>
  );
}

function looksLikeSavioId(id: string): boolean {
  const t = id.trim();
  return t.length >= 4 && t.length <= 128 && /^[a-zA-Z0-9\-_.]+$/.test(t) && !/^row-\d+$/i.test(t);
}

function Kpi({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function RatioTile({
  label,
  formula,
  value,
  foot,
}: {
  label: string;
  formula: string;
  value: string;
  foot: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium">{label}</p>
        <UiTooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border/50 bg-background/80 px-1.5 py-0 text-[10px] text-muted-foreground hover:bg-muted"
            >
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            <p className="font-mono text-[10px] text-muted-foreground">{formula}</p>
            <p className="mt-2 text-muted-foreground">{foot}</p>
          </TooltipContent>
        </UiTooltip>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border/50 bg-card/90">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DataTable({
  heads,
  rows,
  empty,
}: {
  heads: string[];
  rows: { a: string; b: string; c: string }[];
  empty: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {heads.map((h) => (
            <TableHead key={h} className="text-xs">
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={heads.length} className="text-xs text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs font-medium">{r.a}</TableCell>
              <TableCell className="text-xs tabular-nums">{r.b}</TableCell>
              <TableCell className="text-xs tabular-nums">{r.c}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
