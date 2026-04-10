import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound, Upload, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

type FielStatus = {
  configured: boolean;
  certFingerprint: string | null;
  updatedAt: string | null;
};

export function MoffinFielCredentialsSection({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["moffin-fiel-status", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("moffin-fiel", {
        body: { action: "status", clientId },
      });
      if (error) throw new Error(error.message);
      const payload = (data ?? {}) as FielStatus & { error?: string; message?: string };
      if (payload.error) {
        throw new Error(typeof payload.message === "string" ? payload.message : payload.error);
      }
      return payload as FielStatus;
    },
    enabled: !!user && !!clientId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!cerFile || !keyFile) {
        throw new Error("Selecciona el archivo .cer y el .key");
      }
      const certificateBase64 = await fileToBase64(cerFile);
      const privateKeyBase64 = await fileToBase64(keyFile);
      const { data, error } = await supabase.functions.invoke("moffin-fiel", {
        body: {
          action: "save",
          clientId,
          certificateBase64,
          privateKeyBase64,
        },
      });
      if (error) throw new Error(error.message);
      const payload = (data ?? {}) as { error?: string; message?: string };
      if (payload.error) {
        throw new Error(typeof payload.message === "string" ? payload.message : payload.error);
      }
    },
    onSuccess: () => {
      toast.success("Certificado y llave guardados (cifrados). La contraseña no se almacena.");
      queryClient.invalidateQueries({ queryKey: ["moffin-fiel-status", clientId] });
      setOpen(false);
      setCerFile(null);
      setKeyFile(null);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la FIEL");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("moffin-fiel", {
        body: { action: "delete", clientId },
      });
      if (error) throw new Error(error.message);
      const payload = (data ?? {}) as { error?: string; message?: string };
      if (payload.error) {
        throw new Error(typeof payload.message === "string" ? payload.message : payload.error);
      }
    },
    onSuccess: () => {
      toast.success("Credenciales FIEL eliminadas del proyecto");
      queryClient.invalidateQueries({ queryKey: ["moffin-fiel-status", clientId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    },
  });

  const handleDelete = () => {
    if (!window.confirm("¿Eliminar el certificado y la llave guardados para este cliente?")) return;
    deleteMutation.mutate();
  };

  return (
    <>
      <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-foreground">e.firma (FIEL) para constancia y opinión</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          La primera vez sube el <strong className="text-foreground/90">.cer</strong> y el{" "}
          <strong className="text-foreground/90">.key</strong>. No guardamos la contraseña: en cada consulta deberás
          escribirla abajo. Si Moffin rechaza el payload, confirma con soporte Moffin los nombres de campos (variables{" "}
          <code className="text-[9px]">MOFFIN_FIEL_FIELD_*</code> en Supabase).
        </p>
        {isLoading ? (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Comprobando…
          </p>
        ) : status?.configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">FIEL registrada</span>
            {status.certFingerprint ? (
              <code className="text-[9px] bg-background/80 px-1 py-0.5 rounded truncate max-w-[200px]" title={status.certFingerprint}>
                SHA-256 cert: {status.certFingerprint.slice(0, 16)}…
              </code>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => setOpen(true)}>
              <Upload className="h-3 w-3" />
              Actualizar archivos
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] text-destructive gap-1"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3 w-3" />
              Quitar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px] gap-1" onClick={() => setOpen(true)}>
            <Upload className="h-3 w-3" />
            Cargar .cer y .key
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Subir e.firma (SAT)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Certificado (.cer)</Label>
              <Input
                type="file"
                accept=".cer,.crt"
                className="text-xs h-9"
                onChange={(e) => setCerFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Llave privada (.key)</Label>
              <Input
                type="file"
                accept=".key"
                className="text-xs h-9"
                onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              La contraseña de la llave la pedirá la app al ejecutar cada consulta; no se guarda en servidor.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveMutation.isPending || !cerFile || !keyFile}
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
