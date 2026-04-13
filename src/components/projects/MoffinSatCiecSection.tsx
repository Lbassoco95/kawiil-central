import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeySquare, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  functionInvokeUserMessage,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";

type CiecStatus = {
  configured: boolean;
  profileId: number | null;
  updatedAt: string | null;
};

export function MoffinSatCiecSection({ clientId }: { clientId: string }) {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ciecInput, setCiecInput] = useState("");

  const { data: status, isLoading } = useQuery({
    queryKey: ["moffin-sat-ciec-status", clientId],
    queryFn: async () => {
      const { data, error } = await invokeFunctionWithSession("moffin-sat-ciec", {
        action: "status",
        clientId,
      });
      const payload = (data ?? {}) as CiecStatus & { error?: string; message?: string };
      if (payload.error || error) {
        throw new Error(functionInvokeUserMessage(data, error));
      }
      return payload as CiecStatus;
    },
    enabled: !!user && !!session?.access_token && !!clientId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ciec = ciecInput.trim();
      if (!ciec) throw new Error("Ingresa la CIEC del SAT");
      const { data, error } = await invokeFunctionWithSession("moffin-sat-ciec", {
        action: "save",
        clientId,
        ciec,
      });
      const payload = (data ?? {}) as { error?: string; message?: string; ok?: boolean };
      if (payload.error || error) {
        throw new Error(functionInvokeUserMessage(data, error));
      }
    },
    onSuccess: () => {
      toast.success("CIEC guardada (cifrada). Se volverá a registrar el perfil SAT en la próxima consulta.");
      queryClient.invalidateQueries({ queryKey: ["moffin-sat-ciec-status", clientId] });
      setOpen(false);
      setCiecInput("");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la CIEC");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeFunctionWithSession("moffin-sat-ciec", {
        action: "delete",
        clientId,
      });
      const payload = (data ?? {}) as { error?: string; message?: string };
      if (payload.error || error) {
        throw new Error(functionInvokeUserMessage(data, error));
      }
    },
    onSuccess: () => {
      toast.success("CIEC eliminada del servidor");
      queryClient.invalidateQueries({ queryKey: ["moffin-sat-ciec-status", clientId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    },
  });

  const handleDelete = () => {
    if (!window.confirm("¿Eliminar la CIEC guardada para este cliente?")) return;
    deleteMutation.mutate();
  };

  return (
    <>
      <div
        id="moffin-sat-ciec-section"
        className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <KeySquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-foreground">CIEC (Moffin Solutions API)</span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Necesaria para crear el perfil SAT en Moffin y consultar constancia (CSF) y opinión (32D). Se guarda cifrada; no
          la mostramos de nuevo.
        </p>
        {isLoading ? (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Comprobando…
          </p>
        ) : status?.configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">CIEC registrada</span>
            {status.profileId != null ? (
              <span className="text-[9px] text-muted-foreground">Perfil Moffin: #{status.profileId}</span>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => setOpen(true)}>
              Actualizar CIEC
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] text-destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Quitar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={() => setOpen(true)}>
            Guardar CIEC
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">CIEC del SAT</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-xs">Clave CIEC</Label>
            <Input
              type="password"
              autoComplete="new-password"
              className="text-xs h-9"
              value={ciecInput}
              onChange={(e) => setCiecInput(e.target.value)}
              placeholder="La que usas en el portal del SAT"
            />
            <p className="text-[10px] text-muted-foreground">
              Tras guardar, la primera consulta CSF/32D creará o actualizará el perfil en Moffin.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveMutation.isPending || !ciecInput.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar cifrado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
