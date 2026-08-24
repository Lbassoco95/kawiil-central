import { Check, Package } from "lucide-react";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import {
  SERVICE_BUNDLES,
  SERVICE_ORDER,
  formatServices,
  isBundleSelected,
  toggleBundle,
  toggleService,
  type ServiceArea,
} from "@/lib/leadServices";
import { cn } from "@/lib/utils";

interface Props {
  value: readonly ServiceArea[];
  onChange: (next: ServiceArea[]) => void;
  /** Oculta el resumen inferior cuando el contenedor ya lo muestra. */
  hideSummary?: boolean;
}

/**
 * Selección de VARIOS servicios para un lead.
 *
 * Los paquetes (p. ej. Backoffice = Legal + Contabilidad) se muestran arriba y
 * al activarlos marcan sus servicios: lo que se guarda son siempre los
 * servicios reales, nunca el nombre del paquete.
 */
export function LeadServicesPicker({ value, onChange, hideSummary }: Props) {
  const selected = new Set(value);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {SERVICE_BUNDLES.map((bundle) => {
          const active = isBundleSelected(value, bundle);
          return (
            <button
              key={bundle.key}
              type="button"
              onClick={() => onChange(toggleBundle(value, bundle))}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-dashed border-primary/50 text-primary hover:bg-primary/10",
              )}
              title={`Paquete: ${bundle.hint}`}
            >
              <Package className="h-3.5 w-3.5" />
              {bundle.label}
              <span className={cn("font-normal", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                · {bundle.hint}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SERVICE_ORDER.map((service) => {
          const active = selected.has(service);
          return (
            <button
              key={service}
              type="button"
              onClick={() => onChange(toggleService(value, service))}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {active ? <Check className="h-3.5 w-3.5" /> : null}
              {SERVICE_LABELS[service]}
            </button>
          );
        })}
      </div>

      {hideSummary ? null : (
        <p className="text-[11px] text-muted-foreground">
          {value.length === 0
            ? "Sin definir. Puedes elegir varios; Backoffice marca Legal y Contabilidad."
            : `Seleccionados: ${formatServices(value)}`}
        </p>
      )}
    </div>
  );
}
