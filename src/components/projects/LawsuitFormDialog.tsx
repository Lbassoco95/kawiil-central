import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useClients";
import { useOrgProfiles } from "@/hooks/useClients";
import { toast } from "sonner";

const LAWSUIT_TYPES = [
  { value: "laboral", label: "Laboral" },
  { value: "mercantil", label: "Mercantil" },
  { value: "civil", label: "Civil" },
  { value: "fiscal", label: "Fiscal" },
  { value: "penal", label: "Penal" },
  { value: "administrativo", label: "Administrativo" },
  { value: "familiar", label: "Familiar" },
];

const DEFAULT_STAGES = [
  { key: "demanda", label: "Demanda", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "emplazamiento", label: "Emplazamiento", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "contestacion", label: "Contestación de demanda", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "pruebas", label: "Ofrecimiento y admisión de pruebas", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "desahogo", label: "Desahogo de pruebas", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "alegatos", label: "Alegatos", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "sentencia", label: "Sentencia", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "apelacion", label: "Apelación", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "amparo", label: "Amparo", status: "pendiente", date: null, notes: "", completed_at: null },
  { key: "ejecucion", label: "Ejecución de sentencia", status: "pendiente", date: null, notes: "", completed_at: null },
];

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
  const [newAuthorized, setNewAuthorized] = useState("");
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: profiles } = useOrgProfiles();
  const queryClient = useQueryClient();

  // Filter clients that have juicios service
  const lawsuitClients = clients?.filter((c) => c.services?.includes("juicios")) || [];

  const createLawsuit = useMutation({
    mutationFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

      const selectedClient = clients?.find((c) => c.id === clientId);
      const typeLabel = LAWSUIT_TYPES.find((t) => t.value === lawsuitType)?.label || lawsuitType;
      const projectName = `Juicio ${typeLabel} - ${selectedClient?.name || "Sin cliente"}`;

      const lawsuitDetails = {
        lawsuit_type: lawsuitType,
        case_number: caseNumber || null,
        court: court || null,
        plaintiff: plaintiff || null,
        defendant: defendant || null,
        stages: DEFAULT_STAGES,
        deadlines: [],
      };

      const { error } = await supabase
        .from("projects")
        .insert({
          name: projectName,
          description: description || null,
          client_id: clientId || null,
          area: "juicios",
          organization_id: orgId!,
          created_by: user!.id,
          responsible_user_id: responsibleUserId || user!.id,
          lawsuit_details: lawsuitDetails,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Juicio creado exitosamente");
      resetForm();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error al crear juicio: " + error.message);
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
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Juicio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo de juicio *</Label>
              <Select value={lawsuitType} onValueChange={setLawsuitType}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {LAWSUIT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {lawsuitClients.length > 0 ? (
                    lawsuitClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))
                  ) : (
                    clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
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
              <Label>Actor</Label>
              <Input
                placeholder="Nombre del actor"
                value={plaintiff}
                onChange={(e) => setPlaintiff(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Demandado</Label>
              <Input
                placeholder="Nombre del demandado"
                value={defendant}
                onChange={(e) => setDefendant(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Responsable</Label>
              <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar responsable" />
                </SelectTrigger>
                <SelectContent>
                  {profiles?.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              {createLawsuit.isPending ? "Creando..." : "Crear juicio"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
