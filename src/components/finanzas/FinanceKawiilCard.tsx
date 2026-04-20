import { useMemo, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  RefreshCw,
  Clock,
  CheckCircle,
  Wallet,
  Landmark,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  KAWIIL_AI_GRADIENT,
  KAWIIL_AI_HEADER_BG,
} from "@/lib/kawiilAi";

/**
 * FinanceKawiilCard — banner v2.4 "KAWIIL AI · Finanzas en un vistazo".
 *
 * Resume el estado financiero del periodo (gastos pendientes, aprobados,
 * pagados; ingresos cobrados/facturados y cartera si Savio está activo)
 * usando los KPIs ya calculados, sin llamadas extra a IA.
 *
 * Mantiene el mismo lenguaje visual que `EmailKawiilCard`,
 * `CalendarKawiilCard` y `NotificationsKawiilCard` para que el módulo
 * Finanzas se sienta integrado al ecosistema Kawiil AI.
 */

export type FinanceTab = "resumen" | "gastos" | "savio" | "tableros";

interface Props {
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  approvedAmount: number;
  paidCount: number;
  paidAmount: number;
  /** KPIs Savio (solo si el usuario tiene acceso). Pasa null si no aplica. */
  cobradoMes: number | null;
  facturadoMes: number | null;
  carteraSum: number | null;
  carteraCount: number | null;
  onGoToTab: (tab: FinanceTab) => void;
}

function fmtMoneyShort(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function pluralize(n: number, sing: string, plural: string): string {
  return `${n} ${n === 1 ? sing : plural}`;
}

export function FinanceKawiilCard({
  pendingCount,
  pendingAmount,
  approvedCount,
  approvedAmount,
  paidCount,
  paidAmount,
  cobradoMes,
  facturadoMes,
  carteraSum,
  carteraCount,
  onGoToTab,
}: Props) {
  const [refreshTick, setRefreshTick] = useState(0);
  const savioEnabled = cobradoMes !== null && facturadoMes !== null && carteraSum !== null;

  const summary = useMemo(() => {
    void refreshTick;
    const parts: string[] = [];

    if (pendingCount > 0) {
      parts.push(
        `${pluralize(pendingCount, "solicitud en revisión", "solicitudes en revisión")} por ${fmtMoneyShort(pendingAmount)}`,
      );
    }
    if (approvedCount > 0) {
      parts.push(
        `${pluralize(approvedCount, "aprobado listo para pago", "aprobados listos para pago")} (${fmtMoneyShort(approvedAmount)})`,
      );
    }
    if (paidCount > 0) {
      parts.push(`${fmtMoneyShort(paidAmount)} ya liquidado este periodo`);
    }
    if (savioEnabled && (carteraSum ?? 0) > 0) {
      parts.push(
        `cartera por cobrar: ${fmtMoneyShort(carteraSum ?? 0)} en ${pluralize(carteraCount ?? 0, "factura", "facturas")}`,
      );
    }

    if (parts.length === 0) {
      return savioEnabled
        ? "Bandeja financiera al día. Sin solicitudes pendientes y la cartera está limpia. Buen mes."
        : "Sin solicitudes pendientes en finanzas. Cuando registres una nueva, aparecerá aquí.";
    }

    const head = `Resumen del periodo: ${parts.join("; ")}.`;

    if (pendingCount > 0) {
      return `${head} Te sugiero abrir Gastos internos para revisar y aprobar las solicitudes en cola.`;
    }
    if (approvedCount > 0) {
      return `${head} Programa los pagos de los aprobados antes de cierre.`;
    }
    if (savioEnabled && (carteraSum ?? 0) > 0) {
      return `${head} Te sugiero revisar Ingresos facturados para priorizar la cobranza.`;
    }
    return head;
  }, [
    refreshTick,
    pendingCount,
    pendingAmount,
    approvedCount,
    approvedAmount,
    paidCount,
    paidAmount,
    savioEnabled,
    carteraSum,
    carteraCount,
  ]);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40"
      aria-label="Resumen financiero por Kawiil AI"
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-sky-200/40 px-4 py-3 dark:border-sky-800/30"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-sm"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold leading-tight tracking-tight text-foreground">
              KAWIIL AI · Finanzas en un vistazo
              <Badge
                variant="outline"
                className="ml-1 h-4 border-sky-300/70 bg-sky-50/70 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
            </p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
              Pendientes, aprobados y cartera del periodo
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-white/10"
          title="Regenerar resumen"
          aria-label="Regenerar resumen"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 bg-gradient-to-br from-sky-50/70 via-white to-blue-50/40 p-4 dark:from-sky-950/20 dark:via-card dark:to-blue-950/15">
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>

        <div className={`grid gap-2 ${savioEnabled ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
          <button
            type="button"
            onClick={() => onGoToTab("gastos")}
            className="group flex items-center justify-between rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-left transition-colors hover:bg-amber-100/60 dark:border-amber-800/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
          >
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <Clock className="h-3 w-3" /> Pendientes
              </p>
              <p className="mt-0.5 text-base font-semibold leading-none text-amber-700 dark:text-amber-200 tabular-nums">
                {fmtMoneyShort(pendingAmount)}
              </p>
              <p className="mt-0.5 text-[10px] text-amber-700/80 dark:text-amber-300/80">
                {pluralize(pendingCount, "solicitud", "solicitudes")}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-amber-700/70 transition-transform group-hover:translate-x-0.5 dark:text-amber-300/70" />
          </button>

          <button
            type="button"
            onClick={() => onGoToTab("gastos")}
            className="group flex items-center justify-between rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-left transition-colors hover:bg-emerald-100/60 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
          >
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <CheckCircle className="h-3 w-3" /> Aprobados
              </p>
              <p className="mt-0.5 text-base font-semibold leading-none text-emerald-700 dark:text-emerald-200 tabular-nums">
                {fmtMoneyShort(approvedAmount)}
              </p>
              <p className="mt-0.5 text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                {pluralize(approvedCount, "por pagar", "por pagar")}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-emerald-700/70 transition-transform group-hover:translate-x-0.5 dark:text-emerald-300/70" />
          </button>

          <button
            type="button"
            onClick={() => onGoToTab("gastos")}
            className="group flex items-center justify-between rounded-xl border border-sky-200/70 bg-sky-50/60 px-3 py-2 text-left transition-colors hover:bg-sky-100/60 dark:border-sky-800/40 dark:bg-sky-950/20 dark:hover:bg-sky-950/30"
          >
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                <Wallet className="h-3 w-3" /> Pagados
              </p>
              <p className="mt-0.5 text-base font-semibold leading-none text-sky-700 dark:text-sky-200 tabular-nums">
                {fmtMoneyShort(paidAmount)}
              </p>
              <p className="mt-0.5 text-[10px] text-sky-700/80 dark:text-sky-300/80">
                {pluralize(paidCount, "pago", "pagos")}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-sky-700/70 transition-transform group-hover:translate-x-0.5 dark:text-sky-300/70" />
          </button>

          {savioEnabled ? (
            <button
              type="button"
              onClick={() => onGoToTab("savio")}
              className="group flex items-center justify-between rounded-xl border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-left transition-colors hover:bg-rose-100/60 dark:border-rose-800/40 dark:bg-rose-950/20 dark:hover:bg-rose-950/30"
            >
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                  <Landmark className="h-3 w-3" /> Cartera
                </p>
                <p className="mt-0.5 text-base font-semibold leading-none text-rose-700 dark:text-rose-200 tabular-nums">
                  {fmtMoneyShort(carteraSum ?? 0)}
                </p>
                <p className="mt-0.5 text-[10px] text-rose-700/80 dark:text-rose-300/80">
                  {pluralize(carteraCount ?? 0, "factura", "facturas")}
                </p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-rose-700/70 transition-transform group-hover:translate-x-0.5 dark:text-rose-300/70" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-3 text-[11.5px] text-white shadow-sm hover:opacity-95"
            style={{ background: KAWIIL_AI_GRADIENT }}
            onClick={() => onGoToTab(pendingCount > 0 ? "gastos" : approvedCount > 0 ? "gastos" : savioEnabled ? "savio" : "resumen")}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Atender lo prioritario
          </Button>
          {savioEnabled ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-3 text-[11.5px]"
              onClick={() => onGoToTab("tableros")}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Ver tableros
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-3 text-[11.5px] text-muted-foreground hover:text-foreground"
            onClick={() => onGoToTab("resumen")}
          >
            Ver resumen completo
          </Button>
        </div>
      </div>
    </section>
  );
}
