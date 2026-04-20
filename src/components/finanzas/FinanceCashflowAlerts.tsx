import { useMemo } from "react";
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Clock,
  Wallet,
  ArrowRight,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Expense } from "@/hooks/useExpenses";

type Severity = "critical" | "warning" | "info" | "good";

interface CashflowAlert {
  id: string;
  severity: Severity;
  Icon: typeof AlertTriangle;
  title: string;
  detail: string;
  cta?: { label: string; onClick: () => void };
}

interface KpiBucket {
  sum: number;
  count: number;
}

interface Kpis {
  cobradoMes: KpiBucket;
  gastosMes: KpiBucket;
  cartera: KpiBucket;
  facturadoMes: KpiBucket;
}

interface TrendBar {
  key: string;
  ingresos: number;
  gastos: number;
}

interface Props {
  expenses: Expense[];
  kpis?: Kpis;
  trendBars?: TrendBar[];
  savioEnabled: boolean;
  onGoToSavio?: () => void;
  onGoToGastos?: () => void;
}

const TONE: Record<Severity, { wrap: string; pill: string; iconWrap: string }> = {
  critical: {
    wrap: "border-destructive/30 bg-destructive/5",
    pill: "bg-destructive/15 text-destructive",
    iconWrap: "bg-destructive/15 text-destructive",
  },
  warning: {
    wrap: "border-amber-500/30 bg-amber-500/5",
    pill: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    iconWrap: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  info: {
    wrap: "border-primary/25 bg-primary/5",
    pill: "bg-primary/15 text-primary",
    iconWrap: "bg-primary/15 text-primary",
  },
  good: {
    wrap: "border-emerald-500/25 bg-emerald-500/5",
    pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    iconWrap: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

/**
 * Tarjeta de alertas de cashflow para Finanzas (Tanda 5c).
 * Detecta señales accionables a partir de expenses + kpis + trend de los
 * últimos 12 meses. Solo se renderizan las alertas que disparan; si todo
 * está sano, muestra un mensaje "buen estado" compacto.
 */
export function FinanceCashflowAlerts({
  expenses,
  kpis,
  trendBars,
  savioEnabled,
  onGoToSavio,
  onGoToGastos,
}: Props) {
  const alerts = useMemo<CashflowAlert[]>(() => {
    const list: CashflowAlert[] = [];

    const aprobadosNoPagados = expenses.filter((e) => e.status === "aprobado");
    const aprobadosSum = aprobadosNoPagados.reduce((s, e) => s + Number(e.amount), 0);
    const aprobadosViejos = aprobadosNoPagados.filter((e) => {
      const d = daysSince(e.approved_at) ?? daysSince(e.updated_at);
      return d != null && d >= 7;
    });
    if (aprobadosViejos.length > 0 && aprobadosSum > 0) {
      list.push({
        id: "aprobados-sin-pagar",
        severity: aprobadosViejos.length >= 5 || aprobadosSum >= 50_000 ? "critical" : "warning",
        Icon: Wallet,
        title: `${aprobadosViejos.length} gasto${aprobadosViejos.length === 1 ? "" : "s"} aprobado${
          aprobadosViejos.length === 1 ? "" : "s"
        } sin pagar (≥ 7 días)`,
        detail: `Acumulan ${fmtMoney(aprobadosSum)}. Liquida o reagenda con el área financiera.`,
        cta: onGoToGastos ? { label: "Ver gastos", onClick: onGoToGastos } : undefined,
      });
    }

    const enRevisionViejos = expenses.filter((e) => {
      if (!["solicitado", "en_revision"].includes(e.status)) return false;
      const d = daysSince(e.created_at);
      return d != null && d >= 5;
    });
    if (enRevisionViejos.length >= 3) {
      const sum = enRevisionViejos.reduce((s, e) => s + Number(e.amount), 0);
      list.push({
        id: "revision-atascada",
        severity: enRevisionViejos.length >= 8 ? "critical" : "warning",
        Icon: Clock,
        title: `${enRevisionViejos.length} solicitudes esperando revisión (≥ 5 días)`,
        detail: `${fmtMoney(sum)} sin resolver. Revisa la bandeja de aprobaciones.`,
        cta: onGoToGastos ? { label: "Ir a aprobaciones", onClick: onGoToGastos } : undefined,
      });
    }

    if (savioEnabled && kpis) {
      if (kpis.cartera.sum > 0 && kpis.cartera.count > 0) {
        const promFactura = kpis.facturadoMes.sum > 0 ? kpis.facturadoMes.sum : null;
        const carteraVsFactura = promFactura
          ? Math.round((kpis.cartera.sum / promFactura) * 100) / 100
          : null;
        const sev: Severity =
          carteraVsFactura != null && carteraVsFactura >= 3
            ? "critical"
            : carteraVsFactura != null && carteraVsFactura >= 1.5
              ? "warning"
              : "info";
        list.push({
          id: "cartera",
          severity: sev,
          Icon: AlertTriangle,
          title: `Cartera por cobrar: ${fmtMoney(kpis.cartera.sum)}`,
          detail:
            carteraVsFactura != null
              ? `${kpis.cartera.count} factura${kpis.cartera.count === 1 ? "" : "s"} pendientes · equivale a ${carteraVsFactura.toLocaleString("es-MX", { maximumFractionDigits: 1 })}× la facturación del mes.`
              : `${kpis.cartera.count} factura${kpis.cartera.count === 1 ? "" : "s"} pendientes.`,
          cta: onGoToSavio ? { label: "Ver Savio", onClick: onGoToSavio } : undefined,
        });
      }

      if (kpis.facturadoMes.sum > 0) {
        const ratio = kpis.cobradoMes.sum / kpis.facturadoMes.sum;
        if (ratio < 0.4) {
          list.push({
            id: "cobranza-baja",
            severity: ratio < 0.2 ? "critical" : "warning",
            Icon: TrendingDown,
            title: `Cobranza del mes: ${Math.round(ratio * 100)}% de lo facturado`,
            detail: `Cobrado ${fmtMoney(kpis.cobradoMes.sum)} vs facturado ${fmtMoney(kpis.facturadoMes.sum)}. Acelera la cobranza para mejorar liquidez.`,
            cta: onGoToSavio ? { label: "Revisar cobranza", onClick: onGoToSavio } : undefined,
          });
        } else if (ratio >= 0.9) {
          list.push({
            id: "cobranza-saludable",
            severity: "good",
            Icon: BadgeCheck,
            title: `Cobranza saludable: ${Math.round(ratio * 100)}%`,
            detail: `Has cobrado ${fmtMoney(kpis.cobradoMes.sum)} de ${fmtMoney(kpis.facturadoMes.sum)} facturados.`,
          });
        }
      }
    }

    if (trendBars && trendBars.length >= 4 && kpis?.gastosMes) {
      const previos = trendBars.slice(-4, -1);
      if (previos.length === 3) {
        const promedioGastos = previos.reduce((s, b) => s + b.gastos, 0) / 3;
        if (promedioGastos > 0) {
          const delta = kpis.gastosMes.sum / promedioGastos - 1;
          if (delta >= 0.4) {
            list.push({
              id: "gastos-pico",
              severity: delta >= 0.8 ? "critical" : "warning",
              Icon: TrendingUp,
              title: `Gastos del mes ${Math.round(delta * 100)}% por encima del promedio`,
              detail: `Llevas ${fmtMoney(kpis.gastosMes.sum)} pagados vs ${fmtMoney(
                Math.round(promedioGastos),
              )} promedio de los últimos 3 meses. Revisa categorías inusuales.`,
              cta: onGoToGastos ? { label: "Auditar gastos", onClick: onGoToGastos } : undefined,
            });
          } else if (delta <= -0.3) {
            list.push({
              id: "gastos-bajos",
              severity: "good",
              Icon: TrendingDown,
              title: `Gastos del mes ${Math.round(Math.abs(delta) * 100)}% debajo del promedio`,
              detail: `Llevas ${fmtMoney(kpis.gastosMes.sum)} vs ${fmtMoney(Math.round(promedioGastos))} promedio reciente.`,
            });
          }
        }
      }
    }

    return list;
  }, [expenses, kpis, trendBars, savioEnabled, onGoToSavio, onGoToGastos]);

  const hasCritical = alerts.some((a) => a.severity === "critical");

  return (
    <section
      className={cn(
        "rounded-2xl border bg-background/40 p-4 ring-1 ring-border/40 backdrop-blur",
        hasCritical && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className={cn(
            "grid h-7 w-7 place-items-center rounded-lg",
            hasCritical ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary",
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-tight">
            Alertas de cashflow
          </h3>
          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
            Señales calculadas a partir de gastos, cartera y tendencia reciente.
          </p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-emerald-700 dark:text-emerald-400">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 shrink-0" />
            <p className="text-sm font-medium">
              Sin señales críticas. Cashflow saludable según los datos del mes.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {alerts.map((a) => {
            const tone = TONE[a.severity];
            const Icon = a.Icon;
            return (
              <div
                key={a.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                  tone.wrap,
                )}
              >
                <div
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                    tone.iconWrap,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold text-foreground leading-tight">
                      {a.title}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                        tone.pill,
                      )}
                    >
                      {a.severity === "good"
                        ? "OK"
                        : a.severity === "critical"
                          ? "Crítico"
                          : a.severity === "warning"
                            ? "Atención"
                            : "Info"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
                    {a.detail}
                  </p>
                  {a.cta && (
                    <button
                      type="button"
                      onClick={a.cta.onClick}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
                    >
                      {a.cta.label}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
