import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useClients";
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
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { areaOptions } = useAreaOptions();
  const queryClient = useQueryClient();

  const isAccounting = area === "contabilidad" || area === "softlanding";

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
          name,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Proyecto creado exitosamente");
      resetForm();
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
  };

  return (
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
          <div className="space-y-2">
            <Label htmlFor="project-name">Nombre *</Label>
            <Input
              id="project-name"
              placeholder="Nombre del proyecto"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cliente (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Área de servicio</Label>
            <Select value={area} onValueChange={(v) => { setArea(v); setSelectedObligations([]); }}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar área" />
              </SelectTrigger>
              <SelectContent>
                {areaOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              disabled={!name.trim() || createProject.isPending || (isAccounting && selectedObligations.length === 0)}
            >
              {createProject.isPending ? "Creando..." : "Crear proyecto"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
