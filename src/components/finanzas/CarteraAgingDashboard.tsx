import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, TrendingDown, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { useAging, type AgingRow } from "@/hooks/useAging";
import { KpiTile } from "./KpiTile";

const BUCKETS = [
  { key: "corriente", label: "Corriente", color: "#22c55e" },
  { key: "d1_15", label: "1–15 d", color: "#84cc16" },
  { key: "d16_30", label: "16–30 d", color: "#eab308" },
  { key: "d31_60", label: "31–60 d", color: "#f97316" },
  { key: "d60_plus", label: ">60 d", color: "#ef4444" },
] as const;

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency === "USD" ? "USD" : currency === "EUR" ? "EUR" : "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function toCsv(rows: AgingRow[]): string {
  const header = ["Cliente", "Moneda", "Facturas", "Corriente", "1-15", "16-30", "31-60", ">60", "Total", "Máx días"];
  const lines = rows.map((r) =>
    [
      `"${r.clientName.replace(/"/g, '""')}"`,
      r.currency,
      r.invoices,
      r.corriente.toFixed(2),
      r.d1_15.toFixed(2),
      r.d16_30.toFixed(2),
      r.d31_60.toFixed(2),
      r.d60_plus.toFixed(2),
      r.total_balance.toFixed(2),
      r.max_days_late,
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function CarteraAgingDashboard() {
  const { data, isLoading } = useAging();
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? [];
  const [currency, setCurrency] = useState<string>("todas");
  const [search, setSearch] = useState("");

  const currencies = useMemo(() => Array.from(new Set(rows.map((r) => r.currency))), [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (currency !== "todas") list = list.filter((r) => r.currency === currency);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((r) => r.clientName.toLowerCase().includes(s));
    }
    return list;
  }, [rows, currency, search]);

  const shownTotals = useMemo(() => {
    return currency === "todas" ? totals : totals.filter((t) => t.currency === currency);
  }, [totals, currency]);

  const chartData = useMemo(
    () =>
      filtered
        .slice(0, 12)
        .map((r) => ({
          name: r.clientName.length > 18 ? r.clientName.slice(0, 17) + "…" : r.clientName,
          corriente: r.corriente,
          d1_15: r.d1_15,
          d16_30: r.d16_30,
          d31_60: r.d31_60,
          d60_plus: r.d60_plus,
        })),
    [filtered],
  );

  const downloadCsv = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aging_cartera_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Antigüedad de saldos (aging) por cliente. Se calcula sobre las facturas sincronizadas de Savio
          menos los pagos aplicados; el vencimiento sin fecha se estima como emisión + 5 días.
        </p>
        <Button size="sm" variant="outline" onClick={downloadCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-1" /> Exportar CSV
        </Button>
      </div>

      {/* Totales por moneda */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        shownTotals.map((t) => (
          <div key={t.currency} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiTile
                title={`Pendiente ${t.currency}`}
                subtitle="Saldo total de cartera."
                accentClass="before:bg-sky-500"
                icon={<TrendingDown className="h-4 w-4" />}
                footer={<p className="text-[11px] text-muted-foreground">{t.invoices} facturas</p>}
              >
                <p className="text-2xl font-semibold tabular-nums text-sky-700 dark:text-sky-400">
                  {fmt(t.total_balance, t.currency)}
                </p>
              </KpiTile>
              <KpiTile
                title="Corriente"
                subtitle="Aún no vencido."
                accentClass="before:bg-emerald-600"
                icon={<TrendingDown className="h-4 w-4" />}
              >
                <p className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {fmt(t.corriente, t.currency)}
                </p>
              </KpiTile>
              <KpiTile
                title="Vencido 1–60"
                subtitle="Atraso moderado."
                accentClass="before:bg-amber-500"
                icon={<AlertTriangle className="h-4 w-4" />}
              >
                <p className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {fmt(t.d1_15 + t.d16_30 + t.d31_60, t.currency)}
                </p>
              </KpiTile>
              <KpiTile
                title="Vencido >60"
                subtitle="Cartera de riesgo."
                accentClass="before:bg-destructive"
                icon={<AlertTriangle className="h-4 w-4" />}
              >
                <p className="text-2xl font-semibold tabular-nums text-destructive">
                  {fmt(t.d60_plus, t.currency)}
                </p>
              </KpiTile>
            </div>
          </div>
        ))
      )}

      {/* Toolbar */}
      <div className="surface-toolbar flex flex-wrap items-center gap-2 p-3">
        <Input
          placeholder="Buscar cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-56 text-xs"
        />
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las monedas</SelectItem>
            {currencies.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="ml-auto text-[11px]">{filtered.length} clientes</Badge>
      </div>

      {/* Gráfica */}
      {!isLoading && chartData.length > 0 && (
        <Card variant="glass">
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Aging por cliente (top 12)</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} width={50} />
                  <Tooltip formatter={(v: number) => v.toLocaleString("es-MX")} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {BUCKETS.map((b) => (
                    <Bar key={b.key} dataKey={b.key} name={b.label} stackId="a" fill={b.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabla */}
      <div className="glass-card overflow-hidden border-border/50 p-0">
        {isLoading ? (
          <Skeleton className="m-3 h-64 rounded-lg" />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Sin cartera pendiente. Si esperabas datos, sincroniza Savio primero (pestaña Ingresos → «Sincronizar Savio»).
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs text-right">Corriente</TableHead>
                  <TableHead className="text-xs text-right">1–15</TableHead>
                  <TableHead className="text-xs text-right">16–30</TableHead>
                  <TableHead className="text-xs text-right">31–60</TableHead>
                  <TableHead className="text-xs text-right">&gt;60</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={`${r.client_id ?? r.customer_savio_id ?? "x"}-${r.currency}`}>
                    <TableCell className="text-xs">
                      <div className="font-medium">{r.clientName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.currency} · {r.invoices} fact.{r.d60_plus > 0 ? ` · ${r.max_days_late} d máx` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmt(r.corriente, r.currency)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmt(r.d1_15, r.currency)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmt(r.d16_30, r.currency)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmt(r.d31_60, r.currency)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-destructive">{fmt(r.d60_plus, r.currency)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold tabular-nums">{fmt(r.total_balance, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
