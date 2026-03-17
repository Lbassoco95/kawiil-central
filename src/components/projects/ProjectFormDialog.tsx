import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Plus, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useClients";
import { useClientComplianceConfig } from "@/hooks/useCompliance";
import { ComplianceTaskGeneratorModal } from "@/components/compliance/ComplianceTaskGeneratorModal";
import { toast } from "sonner";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];

export const TAX_OBLIGATION_OPTIONS = [
  { key: "isr_provisional", label: "ISR (mensual provisional)" },
  { key: "iva_mensual", label: "IVA (mensual)" },
  { key: "diot", label: "DIOT" },
  { key: "isr_retenciones", label: "ISR retenciones (sueldos/honorarios)" },
  { key: "ieps", label: "IEPS" },
];

export function ProjectFormDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [area, setArea] = useState<string>("");
  const [selectedObligations, setSelectedObligations] = useState<string[]>([]);
  const [complianceGenOpen, setComplianceGenOpen] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { areaOptions } = useAreaOptions();
  const queryClient = useQueryClient();

  const isCumplimiento = area === "cumplimiento";
  const isAccounting = area === "contabilidad" || area === "softlanding";

  // Get compliance config for selected client
  const { data: complianceConfigs } = useClientComplianceConfig(
    isCumplimiento && clientId ? clientId : undefined
  );
  const hasComplianceConfig = (complianceConfigs || []).length > 0;
  const complianceEntityTypeIds = (complianceConfigs || []).map((c) => c.entity_type_id);

  // Auto-set name for compliance projects
  const selectedClient = clients?.find((c) => c.id === clientId);
  const autoName = isCumplimiento && selectedClient
    ? `Cumplimiento — ${selectedClient.name}`
    : name;

  const toggleObligation = (key: string) => {
    setSelectedObligations((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const createProject = useMutation({
    mutationFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const obligations = isAccounting
        ? TAX_OBLIGATION_OPTIONS.filter((o) => selectedObligations.includes(o.key))
        : [];
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: isCumplimiento ? autoName : name,
          description: description || null,
          client_id: clientId || null,
          area: (area as ServiceArea) || null,
          organization_id: orgId!,
          created_by: user!.id,
          responsible_user_id: user!.id,
          tax_obligations: obligations,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Proyecto creado exitosamente");

      if (isCumplimiento && hasComplianceConfig && data) {
        setCreatedProjectId(data.id);
        setComplianceGenOpen(true);
      } else {
        resetForm();
      }
    },
    onError: (error) => {
      toast.error("Error al crear proyecto: " + error.message);
    },
  });

  const resetForm = () => {
    setOpen(false);
    setName("");
    setDescription("");
    setClientId("");
    setArea("");
    setSelectedObligations([]);
    setCreatedProjectId(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo proyecto
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear proyecto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!isCumplimiento && (
              <div className="space-y-2">
                <Label htmlFor="project-name">Nombre *</Label>
                <Input
                  id="project-name"
                  placeholder="Nombre del proyecto"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Cliente</Label>
              <SearchableSelect
                options={(clients || []).map((c) => ({ value: c.id, label: c.name }))}
                value={clientId}
                onValueChange={setClientId}
                placeholder="Seleccionar cliente (opcional)"
                searchPlaceholder="Buscar cliente..."
              />
            </div>

            <div className="space-y-2">
              <Label>Célula de servicio</Label>
              <SearchableSelect
                options={areaOptions}
                value={area}
                onValueChange={(v) => { setArea(v); setSelectedObligations([]); }}
                placeholder="Seleccionar célula"
                searchPlaceholder="Buscar célula..."
              />
            </div>

            {/* Compliance info */}
            {isCumplimiento && clientId && !hasComplianceConfig && (
              <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400 rounded-md p-3">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Este cliente no tiene tipo de entidad regulada configurado.{" "}
                  <a href={`/clientes/${clientId}`} className="underline font-medium">
                    Configurar ahora
                  </a>
                </span>
              </div>
            )}

            {isCumplimiento && clientId && hasComplianceConfig && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-sm font-semibold">Proyecto de Cumplimiento</Label>
                <p className="text-sm text-muted-foreground">
                  Se creará: <strong>{autoName}</strong>
                </p>
                <div className="flex flex-wrap gap-1">
                  {(complianceConfigs || []).map((c) => (
                    <Badge key={c.id} variant="outline" className="text-xs">
                      {c.entity_type?.name || "—"}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Al crear, se abrirá el generador de tareas obligatorias.
                </p>
              </div>
            )}

            {isAccounting && (
              <div className="space-y-3 rounded-md border p-4">
                <Label className="text-sm font-semibold">Obligaciones fiscales a presentar</Label>
                <p className="text-xs text-muted-foreground">
                  Selecciona las declaraciones que aplican a este proyecto.
                </p>
                <div className="space-y-2">
                  {TAX_OBLIGATION_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedObligations.includes(opt.key)}
                        onCheckedChange={() => toggleObligation(opt.key)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                placeholder="Descripción del proyecto (opcional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => createProject.mutate()}
                disabled={
                  (!isCumplimiento && !name.trim()) ||
                  (isCumplimiento && (!clientId || !hasComplianceConfig)) ||
                  createProject.isPending ||
                  (isAccounting && selectedObligations.length === 0)
                }
              >
                {createProject.isPending ? "Creando..." : "Crear proyecto"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {createdProjectId && (
        <ComplianceTaskGeneratorModal
          open={complianceGenOpen}
          onOpenChange={(o) => {
            setComplianceGenOpen(o);
            if (!o) resetForm();
          }}
          projectId={createdProjectId}
          entityTypeIds={complianceEntityTypeIds}
          responsibleUserId={user!.id}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ["project-tasks", createdProjectId] });
            resetForm();
          }}
        />
      )}
    </>
  );
}
