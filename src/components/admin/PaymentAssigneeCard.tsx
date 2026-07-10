import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, X } from "lucide-react";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useOrgProfiles } from "@/hooks/useClients";
import { useOrgSettings, useUpdateOrgSettings } from "@/hooks/useOrgSettings";

/**
 * Responsable de pagos: al aprobar un gasto se genera una tarea de pago/reembolso
 * asignada a esta persona (hoy Viri). Se puede cambiar al responsable principal o
 * agregar co-responsables que también reciban la tarea.
 */
export function PaymentAssigneeCard() {
  const { data: profiles } = useOrgProfiles();
  const { settings, isLoading } = useOrgSettings();
  const update = useUpdateOrgSettings();

  const primary = settings.payment_assignee_user_id || "";
  const additional = useMemo(
    () => settings.payment_additional_assignee_user_ids ?? [],
    [settings.payment_additional_assignee_user_ids],
  );

  const nameOf = (id: string) =>
    (profiles ?? []).find((p) => p.user_id === id)?.full_name || "—";

  const primaryOptions = (profiles ?? []).map((p) => ({ value: p.user_id, label: p.full_name }));
  const addableOptions = (profiles ?? [])
    .filter((p) => p.user_id !== primary && !additional.includes(p.user_id))
    .map((p) => ({ value: p.user_id, label: p.full_name }));

  const setPrimary = (v: string) =>
    update.mutate({
      payment_assignee_user_id: v || null,
      // Evita duplicar: si el nuevo principal estaba como adicional, lo quitamos.
      payment_additional_assignee_user_ids: additional.filter((u) => u !== v),
    });

  const addAdditional = (v: string) => {
    if (!v || v === primary || additional.includes(v)) return;
    update.mutate({ payment_additional_assignee_user_ids: [...additional, v] });
  };

  const removeAdditional = (v: string) =>
    update.mutate({ payment_additional_assignee_user_ids: additional.filter((u) => u !== v) });

  return (
    <Card variant="glass">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Responsable de pagos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Responsable principal</Label>
          <SearchableSelect
            options={primaryOptions}
            value={primary}
            onValueChange={setPrimary}
            placeholder={isLoading ? "Cargando…" : "Selecciona un responsable"}
            emptyLabel="Sin responsable"
            disabled={update.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Al aprobar un gasto se crea una tarea de pago (o de cobro/reembolso) asignada a
            esta persona con la fecha en que se debe realizar el pago.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Co-responsables adicionales</Label>
          {additional.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {additional.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  {nameOf(id)}
                  <button
                    type="button"
                    onClick={() => removeAdditional(id)}
                    disabled={update.isPending}
                    className="rounded-full p-0.5 hover:bg-background/60"
                    aria-label={`Quitar a ${nameOf(id)}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <SearchableSelect
            options={addableOptions}
            value=""
            onValueChange={addAdditional}
            placeholder="Agregar co-responsable…"
            disabled={update.isPending || addableOptions.length === 0}
          />
          <p className="text-xs text-muted-foreground">
            También reciben la tarea de pago. Útil para respaldo o para repartir la operación.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
