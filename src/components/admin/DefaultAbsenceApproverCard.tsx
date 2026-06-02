import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useOrgProfiles } from "@/hooks/useClients";
import { useOrgSettings, useUpdateOrgSettings } from "@/hooks/useOrgSettings";

/**
 * Aprobador por defecto de ausencias: recibe las solicitudes cuya célula no
 * tiene responsable asignado. Las células con responsable enrutan a esa persona.
 */
export function DefaultAbsenceApproverCard() {
  const { data: profiles } = useOrgProfiles();
  const { settings, isLoading } = useOrgSettings();
  const update = useUpdateOrgSettings();

  const value = settings.default_absence_approver_user_id || "";
  const options = (profiles ?? []).map((p) => ({ value: p.user_id, label: p.full_name }));

  return (
    <Card variant="glass">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Aprobador por defecto de ausencias
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label>Quién aprueba cuando la célula no tiene responsable</Label>
        <SearchableSelect
          options={options}
          value={value}
          onValueChange={(v) => update.mutate({ default_absence_approver_user_id: v || null })}
          placeholder={isLoading ? "Cargando…" : "Selecciona un aprobador"}
          disabled={update.isPending}
        />
        <p className="text-xs text-muted-foreground">
          Las solicitudes de una célula con responsable asignado llegan a esa persona;
          el resto cae aquí.
        </p>
      </CardContent>
    </Card>
  );
}
