import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { UserOrTextSingle, UserOrTextMulti } from "./UserOrTextInput";
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
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useClients";
import { useClientSelectOptions } from "@/hooks/useClientSelectOptions";
import { useOrgProfiles } from "@/hooks/useClients";
import { toast } from "sonner";
import {
  LAWSUIT_TYPE_OPTIONS,
  defaultStagesForType,
  isLegalProcedure,
  partyLabels,
} from "@/lib/lawsuits";
import type { Database } from "@/integrations/supabase/types";

interface LawsuitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LawsuitFormDialog({ open, onOpenChange }: LawsuitFormDialogProps) {
  const [lawsuitType, setLawsuitType] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [court, setCourt] = useState("");
  const [plaintiff, setPlaintiff] = useState("");
  const [defendant, setDefendant] = useState("");
  const [clientId, setClientId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [description, setDescription] = useState("");
  const [leadAttorney, setLeadAttorney] = useState("");
  const [substituteAttorney, setSubstituteAttorney] = useState("");
  const [authorizedPersons, setAuthorizedPersons] = useState<string[]>([]);
  
  const { user } = useAuth();
  const { data: clients } = useClients();
  const clientSelectOptions = useClientSelectOptions();
  const { data: profiles } = useOrgProfiles();
  const queryClient = useQueryClient();


  const createLawsuit = useMutation({
    mutationFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

      const selectedClient = clients?.find((c) => c.id === clientId);
      const typeLabel = LAWSUIT_TYPE_OPTIONS.find((t) => t.value === lawsuitType)?.label || lawsuitType;
      const procedure = isLegalProcedure(lawsuitType);
      const opponent = defendant || plaintiff || "";
      const base = procedure ? typeLabel : `Juicio ${typeLabel}`;
      const clientLabel = selectedClient?.name || "Sin cliente";
      const projectName = opponent ? `${base} - ${clientLabel} vs ${opponent}` : `${base} - ${clientLabel}`;

      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          name: projectName,
          description: description || null,
          client_id: clientId || null,
          area: "juicios",
          organization_id: orgId!,
          created_by: user!.id,
          responsible_user_id: responsibleUserId || user!.id,
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      // El registro del juicio/trámite vive en project_lawsuits (pestaña «Juicios y trámites»).
      const stages = defaultStagesForType(lawsuitType);
      const people = [
        leadAttorney && `Abogado titular: ${leadAttorney}`,
        substituteAttorney && `Abogado sustituto: ${substituteAttorney}`,
        authorizedPersons.length > 0 && `Autorizados: ${authorizedPersons.join(", ")}`,
      ].filter(Boolean);
      const { error: lawsuitError } = await supabase.from("project_lawsuits").insert({
        project_id: project.id,
        organization_id: orgId!,
        name: projectName,
        lawsuit_type: lawsuitType,
        case_number: caseNumber || null,
        court: court || null,
        plaintiff: plaintiff || null,
        defendant: defendant || null,
        status: "en_tramite",
        current_stage: stages[0]?.label ?? null,
        stages: stages as unknown as Database["public"]["Tables"]["project_lawsuits"]["Insert"]["stages"],
        notes: people.length > 0 ? people.join("\n") : null,
        created_by: user!.id,
      });
      if (lawsuitError) {
        await supabase.from("projects").delete().eq("id", project.id);
        throw lawsuitError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project-lawsuits"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      toast.success("Creado exitosamente");
      resetForm();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error al crear: " + error.message);
    },
  });

  const resetForm = () => {
    setLawsuitType("");
    setCaseNumber("");
    setCourt("");
    setPlaintiff("");
    setDefendant("");
    setClientId("");
    setResponsibleUserId("");
    setDescription("");
    setLeadAttorney("");
    setSubstituteAttorney("");
    setAuthorizedPersons([]);
    
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo juicio o trámite</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={lawsuitType} onValueChange={setLawsuitType}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {LAWSUIT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cliente *</Label>
              <SearchableSelect
                options={clientSelectOptions}
                value={clientId}
                onValueChange={setClientId}
                placeholder="Seleccionar cliente"
                searchPlaceholder="Buscar cliente..."
              />
            </div>

            <div className="space-y-2">
              <Label>No. de Expediente</Label>
              <Input
                placeholder="EXP-123/2026"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Juzgado / Tribunal</Label>
              <Input
                placeholder="Juzgado Segundo de lo Civil"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{partyLabels(lawsuitType).first}</Label>
              <Input
                placeholder="Nombre del actor"
                value={plaintiff}
                onChange={(e) => setPlaintiff(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{partyLabels(lawsuitType).second}</Label>
              <Input
                placeholder="Nombre del demandado"
                value={defendant}
                onChange={(e) => setDefendant(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Responsable</Label>
              <SearchableSelect
                options={(profiles || []).map((p) => ({ value: p.user_id, label: p.full_name }))}
                value={responsibleUserId}
                onValueChange={setResponsibleUserId}
                placeholder="Seleccionar responsable"
                searchPlaceholder="Buscar usuario..."
              />
            </div>

            <div className="space-y-2">
              <Label>Abogado Patrono</Label>
              <UserOrTextSingle
                value={leadAttorney}
                onChange={setLeadAttorney}
                profiles={profiles?.map((p) => ({ user_id: p.user_id, full_name: p.full_name })) || []}
                placeholder="Escribir nombre o seleccionar usuario..."
              />
            </div>

            <div className="space-y-2">
              <Label>Abogado Sustituto</Label>
              <UserOrTextSingle
                value={substituteAttorney}
                onChange={setSubstituteAttorney}
                profiles={profiles?.map((p) => ({ user_id: p.user_id, full_name: p.full_name })) || []}
                placeholder="Escribir nombre o seleccionar usuario..."
              />
            </div>
          </div>

          {/* Autorizados */}
          <div className="space-y-2">
            <Label>Autorizados</Label>
            <UserOrTextMulti
              values={authorizedPersons}
              onChange={setAuthorizedPersons}
              profiles={profiles?.map((p) => ({ user_id: p.user_id, full_name: p.full_name })) || []}
              placeholder="Nombre del autorizado"
              hint="Presiona Enter o el botón para agregar. Pueden o no ser usuarios del sistema."
            />
          </div>

          <div className="space-y-2">
            <Label>Notas iniciales</Label>
            <Textarea
              placeholder="Descripción general del juicio..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="rounded-md border p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              Se crearán automáticamente las etapas procesales: Demanda, Emplazamiento, Contestación, 
              Pruebas, Desahogo, Alegatos, Sentencia, Apelación, Amparo y Ejecución. 
              Podrás agregar términos y fechas clave desde el detalle del juicio.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button
              onClick={() => createLawsuit.mutate()}
              disabled={!lawsuitType || !clientId || createLawsuit.isPending}
            >
              {createLawsuit.isPending ? "Creando..." : "Crear"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
