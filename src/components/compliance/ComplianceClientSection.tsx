import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ComplianceEntitySelector } from "./ComplianceEntitySelector";
import {
  useClientComplianceConfig,
  useSaveClientCompliance,
} from "@/hooks/useCompliance";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield } from "lucide-react";

interface ComplianceClientSectionProps {
  clientId: string;
  readOnly?: boolean;
}

export function ComplianceClientSection({ clientId, readOnly }: ComplianceClientSectionProps) {
  const { data: configs, isLoading } = useClientComplianceConfig(clientId);
  const saveCompliance = useSaveClientCompliance();

  const [enabled, setEnabled] = useState(false);
  const [selectedEntityTypeIds, setSelectedEntityTypeIds] = useState<string[]>([]);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [authorizationDate, setAuthorizationDate] = useState("");
  const [complianceOfficerName, setComplianceOfficerName] = useState("");

  useEffect(() => {
    if (configs && configs.length > 0) {
      setEnabled(true);
      setSelectedEntityTypeIds(configs.map((c) => c.entity_type_id));
      setRegistrationNumber(configs[0].registration_number || "");
      setAuthorizationDate(configs[0].authorization_date || "");
      setComplianceOfficerName(configs[0].compliance_officer_name || "");
    } else if (configs) {
      setEnabled(false);
      setSelectedEntityTypeIds([]);
    }
  }, [configs]);

  const handleSave = async () => {
    await saveCompliance.mutateAsync({
      clientId,
      entityTypeIds: enabled ? selectedEntityTypeIds : [],
      registrationNumber,
      authorizationDate,
      complianceOfficerName,
    });
  };

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">Cumplimiento regulatorio</Label>
        </div>
        {!readOnly && (
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        )}
      </div>

      {enabled && (
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-sm mb-2 block">Tipo de entidad regulada</Label>
            <div className="max-h-64 overflow-y-auto rounded-md border p-3">
              <ComplianceEntitySelector
                selectedIds={selectedEntityTypeIds}
                onChange={setSelectedEntityTypeIds}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Número de registro / Folio regulatorio</Label>
              <Input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="Folio o número de registro"
                readOnly={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Fecha de autorización / inicio de operaciones</Label>
              <Input
                type="date"
                value={authorizationDate}
                onChange={(e) => setAuthorizationDate(e.target.value)}
                readOnly={readOnly}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Responsable de cumplimiento en el cliente</Label>
            <Input
              value={complianceOfficerName}
              onChange={(e) => setComplianceOfficerName(e.target.value)}
              placeholder="Nombre del oficial de cumplimiento del cliente"
              readOnly={readOnly}
            />
          </div>

          {!readOnly && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveCompliance.isPending || selectedEntityTypeIds.length === 0}
              >
                {saveCompliance.isPending ? "Guardando..." : "Guardar cumplimiento"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
