import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Save, Pencil, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const CRITICALITY_OPTIONS = [
  { value: "normal", label: "🟢 Normal", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  { value: "atencion", label: "🟡 Atención", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { value: "critico", label: "🔴 Crítico", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
];

export const DELAY_CATEGORIES = [
  { value: "__none__", label: "Sin atraso" },
  { value: "atraso_cliente", label: "Atraso del cliente" },
  { value: "atraso_sat", label: "Atraso del SAT / autoridad" },
  { value: "recurso_interno", label: "Recurso interno" },
  { value: "dependencia_externa", label: "Dependencia externa" },
  { value: "otro", label: "Otro" },
];

interface Props {
  projectId: string;
  criticalityLevel: string;
  delayCategory: string | null;
  delayNotes: string | null;
}

export function CriticalityDelayCard({ projectId, criticalityLevel, delayCategory, delayNotes }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [crit, setCrit] = useState(criticalityLevel || "normal");
  const [delay, setDelay] = useState(delayCategory || "");
  const [notes, setNotes] = useState(delayNotes || "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("projects")
        .update({
          criticality_level: crit,
          delay_category: delay || null,
          delay_notes: notes || null,
        } as any)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Criticidad actualizada");
      setEditing(false);
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  const handleCancel = () => {
    setCrit(criticalityLevel || "normal");
    setDelay(delayCategory || "");
    setNotes(delayNotes || "");
    setEditing(false);
  };

  const currentCriticality = CRITICALITY_OPTIONS.find((c) => c.value === (criticalityLevel || "normal"));
  const currentDelay = DELAY_CATEGORIES.find((d) => d.value === delayCategory);

  return (
    <Card className={criticalityLevel === "critico" ? "border-destructive/40" : criticalityLevel === "atencion" ? "border-yellow-400/40" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          Semáforo y atrasos
        </CardTitle>
        {!editing ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3 mr-1" /> Editar
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="default" size="sm" className="h-7 text-xs" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="h-3 w-3 mr-1" /> Guardar
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={handleCancel}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Criticality */}
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Criticidad</span>
          {editing ? (
            <Select value={crit} onValueChange={setCrit}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRITICALITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline" className={currentCriticality?.color}>
              {currentCriticality?.label}
            </Badge>
          )}
        </div>

        {/* Delay category */}
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Motivo de atraso</span>
          {editing ? (
            <Select value={delay || "__none__"} onValueChange={(v) => setDelay(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DELAY_CATEGORIES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span>{currentDelay?.label || "Sin atraso"}</span>
          )}
        </div>

        {/* Delay notes */}
        {(editing || delayCategory) && (
          <div>
            <span className="text-muted-foreground text-xs">Notas de atraso</span>
            {editing ? (
              <Textarea
                className="mt-1 text-sm min-h-[60px]"
                placeholder="Detalle de la situación..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
                {delayNotes || "—"}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
