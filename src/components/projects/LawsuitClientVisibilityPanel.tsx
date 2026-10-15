import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];

/** Publica o esconde este juicio/trámite en el portal del cliente del proyecto. */
export function LawsuitClientVisibilityPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const queryClient = useQueryClient();

  const setVisible = useMutation({
    mutationFn: async (visible: boolean) => {
      const { error } = await supabase
        .from("project_lawsuits")
        .update({ client_visible: visible })
        .eq("id", lawsuit.id);
      if (error) throw error;
    },
    onSuccess: (_, visible) => {
      queryClient.invalidateQueries({ queryKey: ["project-lawsuits", lawsuit.project_id] });
      toast.success(visible ? "Ahora lo ve el cliente en su portal" : "Ya no lo ve el cliente");
    },
    onError: (e: Error) => toast.error("No se pudo actualizar: " + e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {lawsuit.client_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            Visible para el cliente
          </p>
          <p className="text-xs text-muted-foreground">
            {lawsuit.client_visible
              ? "El cliente ve este asunto en su portal: etapa actual, avance, estatus, audiencia y plazo."
              : "El cliente no ve este asunto. Actívalo para publicarlo en su portal."}
          </p>
        </div>
        <Switch
          checked={lawsuit.client_visible}
          onCheckedChange={(v) => setVisible.mutate(v)}
          disabled={setVisible.isPending}
        />
      </div>
      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
        <li>Las actuaciones solo se muestran si las marcas «Visible para el cliente» (pestaña Actuaciones).</li>
        <li>Los documentos solo se muestran si los marcas «Compartido con el cliente» (pestaña Documentos).</li>
        <li>
          El enlace y el código son uno solo para todo el proyecto: se generan con el botón «Acceso del cliente»
          en la lista de juicios y trámites.
        </li>
      </ul>
    </div>
  );
}
