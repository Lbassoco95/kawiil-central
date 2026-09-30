import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";
import type { ContractAnswers, ContractPackageKind } from "@/types/contracts";
import { FIELD_LABELS, wizardStepsFor } from "@/lib/contractOnboardingBlocks";
import { usePricingCatalog, enrichBillingAnswers } from "@/hooks/useContractEngagements";
import { SOFTLANDING_FEE_DEFAULTS } from "@/lib/contractPricingCatalog";

interface Props {
  packageKind: ContractPackageKind;
  answers: ContractAnswers;
  updatedByRole?: string | null;
  updatedAt?: string | null;
  mode: "staff" | "client";
  saving?: boolean;
  onChange: (patch: ContractAnswers) => void;
  onSave?: () => void;
}

export function ContractWizard({
  packageKind,
  answers,
  updatedByRole,
  updatedAt,
  mode,
  saving,
  onChange,
  onSave,
}: Props) {
  const steps = useMemo(() => wizardStepsFor(packageKind, mode), [packageKind, mode]);
  const [stepIdx, setStepIdx] = useState(0);
  const step = steps[stepIdx];
  const { data: catalog = [] } = usePricingCatalog(packageKind);
  const progress = ((stepIdx + 1) / steps.length) * 100;

  useEffect(() => {
    // Defaults Softlanding fees
    if (packageKind !== "softlanding") return;
    const patch: ContractAnswers = {};
    if (answers["fees.constitucion"] == null) patch["fees.constitucion"] = SOFTLANDING_FEE_DEFAULTS.constitucion_mxn;
    if (answers["fees.recurrente_usd"] == null) patch["fees.recurrente_usd"] = SOFTLANDING_FEE_DEFAULTS.recurrente_usd;
    if (Object.keys(patch).length) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageKind]);

  const setField = (key: string, value: string | number) => {
    if (key === "plan_id") {
      const plan = catalog.find((p) => p.plan_code === value);
      if (plan) {
        const discount = Number(answers.discount_amount) || 0;
        onChange(enrichBillingAnswers(answers, plan, discount, null));
        return;
      }
    }
    if (key === "discount_amount" || key === "net_price") {
      const planCode = String(answers.plan_id || "");
      const plan = catalog.find((p) => p.plan_code === planCode);
      if (plan) {
        const discount = key === "discount_amount" ? Number(value) || 0 : Number(answers.discount_amount) || 0;
        const override = key === "net_price" ? Number(value) : null;
        onChange(enrichBillingAnswers({ ...answers, [key]: value }, plan, discount, override));
        return;
      }
    }
    onChange({ [key]: value });
  };

  const renderField = (key: string) => {
    const label =
      key === "client.rfc" && packageKind === "softlanding"
        ? "RFC (opcional — se captura después si aún no hay)"
        : FIELD_LABELS[key] || key;
    const val = answers[key] ?? "";

    if (key === "plan_id") {
      return (
        <div key={key} className="space-y-2">
          <Label>{label}</Label>
          <Select value={String(val || "")} onValueChange={(v) => setField(key, v)}>
            <SelectTrigger>
              <SelectValue placeholder="Elige un plan" />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((p) => (
                <SelectItem key={p.plan_code} value={p.plan_code}>
                  {p.plan_name} — ${Number(p.list_price).toLocaleString("es-MX")} / mes
                  {p.max_operations ? ` (hasta ${p.max_operations} ops)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (key === "sociedad.objeto" || key === "authorized_persons" || key === "services.labeled") {
      return (
        <div key={key} className="space-y-2">
          <Label>{label}</Label>
          <Textarea
            value={String(val)}
            onChange={(e) => setField(key, e.target.value)}
            rows={3}
            className="resize-y"
          />
        </div>
      );
    }

    const inputType =
      key.includes("price") || key.includes("capital") || key.includes("fees") || key.includes("discount") || key.includes("max_")
        ? "number"
        : key.includes("email")
          ? "email"
          : "text";

    return (
      <div key={key} className="space-y-2">
        <Label htmlFor={key}>{label}</Label>
        <Input
          id={key}
          type={inputType}
          value={String(val)}
          onChange={(e) =>
            setField(key, inputType === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)
          }
        />
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Paso {stepIdx + 1} de {steps.length}
          </p>
          {updatedByRole ? (
            <Badge variant="outline" className="gap-1 text-[11px] font-normal">
              <Users className="h-3 w-3" />
              Última edición: {updatedByRole === "staff" ? "Kawiil" : "cliente"}
              {updatedAt
                ? ` · ${new Date(updatedAt).toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`
                : ""}
            </Badge>
          ) : null}
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <div className="space-y-1">
        <h3 className="text-xl font-semibold tracking-tight">{step.title}</h3>
        {step.description ? <p className="text-sm text-muted-foreground">{step.description}</p> : null}
        {mode === "client" ? (
          <p className="text-xs text-muted-foreground">
            El equipo Kawiil también puede ayudarte a completar estos datos; verás sus cambios aquí.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Vista asistida: lo que guardes es visible al instante en el link del cliente.
          </p>
        )}
      </div>

      {step.id === "summary" ? (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
          {Object.entries(answers)
            .filter(([, v]) => v !== null && v !== undefined && String(v).length > 0)
            .slice(0, 24)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border/40 py-1.5 last:border-0">
                <span className="text-muted-foreground">{FIELD_LABELS[k] || k}</span>
                <span className="font-medium text-right break-all">{String(v)}</span>
              </div>
            ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1">{step.fields.map(renderField)}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={stepIdx === 0}
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Anterior
        </Button>
        <div className="flex gap-2">
          {onSave ? (
            <Button type="button" variant="secondary" disabled={saving} onClick={onSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Guardar
            </Button>
          ) : null}
          {stepIdx < steps.length - 1 ? (
            <Button type="button" onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}>
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
