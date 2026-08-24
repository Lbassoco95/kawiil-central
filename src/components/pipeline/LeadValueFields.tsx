import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Repeat, Coins, Plus } from "lucide-react";
import { formatMxnShort } from "@/lib/pipelineFormat";
import {
  DEFAULT_CONTRACT_MONTHS,
  computeTcv,
  contractMonths,
  formatServices,
  splitByBilling,
  suggestedCompanions,
  type ServiceArea,
  type ValueBreakdown,
} from "@/lib/leadServices";

interface Props {
  value: ValueBreakdown;
  onChange: (next: ValueBreakdown) => void;
  /** Servicios elegidos: definen qué montos se esperan y qué sugerir. */
  services: readonly ServiceArea[];
  /** Si se pasa, ofrece agregar los servicios que suelen acompañar (backoffice). */
  onAddServices?: (services: ServiceArea[]) => void;
}

function toNumberOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Desglose del valor del deal: pago único + mensualidad recurrente.
 *
 * Un solo monto no sirve para proyectar: el Soft Landing se cobra una vez y el
 * backoffice es mensualidad. Aquí se capturan por separado y se muestra el
 * valor total del contrato (lo que se guarda en `estimated_value`).
 */
export function LeadValueFields({ value, onChange, services, onAddServices }: Props) {
  const billing = splitByBilling(services);
  const companions = suggestedCompanions(services);
  const months = contractMonths(value.months);
  const tcv = computeTcv(value);
  const monthly = value.monthly ?? 0;

  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label className="flex items-center gap-1.5 text-xs">
            <Coins className="h-3.5 w-3.5" />
            Pago único (MXN)
          </Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="bg-background"
            placeholder="Ej. 45000"
            value={value.oneTime ?? ""}
            onChange={(e) => onChange({ ...value, oneTime: toNumberOrNull(e.target.value) })}
          />
        </div>
        <div>
          <Label className="flex items-center gap-1.5 text-xs">
            <Repeat className="h-3.5 w-3.5" />
            Mensualidad (MXN)
          </Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="bg-background"
            placeholder="Ej. 11500"
            value={value.monthly ?? ""}
            onChange={(e) => onChange({ ...value, monthly: toNumberOrNull(e.target.value) })}
          />
        </div>
        <div>
          <Label className="text-xs">Meses a proyectar</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            className="bg-background"
            placeholder={String(DEFAULT_CONTRACT_MONTHS)}
            value={value.months ?? ""}
            onChange={(e) => onChange({ ...value, months: toNumberOrNull(e.target.value) })}
            disabled={monthly <= 0}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="text-[11px] text-muted-foreground">
          {monthly > 0
            ? `Valor del contrato: pago único + ${formatMxnShort(monthly)} × ${months} meses`
            : "Valor del contrato: sólo pago único"}
        </span>
        <span className="text-sm font-bold tabular-nums text-primary">
          {formatMxnShort(tcv)} MXN
        </span>
      </div>

      {services.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {billing.oneTime.length > 0
            ? `Pago único esperado por: ${formatServices(billing.oneTime)}. `
            : ""}
          {billing.monthly.length > 0
            ? `Mensualidad esperada por: ${formatServices(billing.monthly)}.`
            : ""}
        </p>
      ) : null}

      {companions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5">
          <span className="text-[11px] text-primary">
            {formatServices(services.filter((s) => (s === "softlanding" || s === "constitucion_nacional")))}{" "}
            normalmente sigue con seguimiento mensual ({formatServices(companions)}).
          </span>
          {onAddServices ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              onClick={() => onAddServices(companions)}
            >
              <Plus className="mr-1 h-3 w-3" />
              Agregarlo
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
