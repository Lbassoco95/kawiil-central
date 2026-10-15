import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatMX } from "@/lib/dateUtils";
import {
  generatePortalCode,
  generatePortalToken,
  portalCodeHash,
  portalDb,
  portalUrl,
  sha256Hex,
  type ProjectClientLink,
} from "@/lib/lawsuitPortal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface Revealed {
  url: string;
  code: string;
}

/**
 * Enlace privado + código para que el cliente consulte el expediente completo del proyecto:
 * todos los juicios/trámites marcados como visibles, con su avance y documentos (solo lectura).
 */
export function ProjectClientPortalPanel({ projectId, organizationId }: { projectId: string; organizationId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const queryKey = ["project-client-link", projectId];

  const { data: link, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await portalDb
        .from("project_client_links")
        .select("id, project_id, active, last_viewed_at, locked_until, created_at, updated_at")
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProjectClientLink | null;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const token = generatePortalToken();
      const code = generatePortalCode();
      const fields = {
        token_hash: await sha256Hex(token),
        code_hash: await portalCodeHash(token, code),
        active: true,
        failed_attempts: 0,
        locked_until: null,
      };
      if (link) {
        const { error } = await portalDb.from("project_client_links").update(fields).eq("id", link.id);
        if (error) throw error;
      } else {
        const { error } = await portalDb.from("project_client_links").insert({
          ...fields,
          project_id: projectId,
          organization_id: organizationId,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
      return { url: portalUrl(token), code } as Revealed;
    },
    onSuccess: (r) => {
      setRevealed(r);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error("No se pudo generar el acceso: " + e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (active: boolean) => {
      const { error } = await portalDb.from("project_client_links").update({ active }).eq("id", link!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error("No se pudo actualizar: " + e.message),
  });

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const message = revealed
    ? `Hola, puedes consultar el avance de tus asuntos y sus documentos aquí: ${revealed.url}\nCódigo de acceso: ${revealed.code}`
    : "";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Qué ve el cliente
        </p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>Un solo enlace para todo el proyecto: ve cada juicio o trámite que marques como «Visible para el cliente».</li>
          <li>De cada uno: etapa actual, avance, estatus, próxima audiencia y plazo.</li>
          <li>Solo las actuaciones marcadas «Visible para el cliente» y los documentos «Compartidos con el cliente».</li>
          <li>Nunca ve comentarios, tareas ni notas internas. Es solo lectura.</li>
        </ul>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  link?.active
                    ? "bg-green-500/10 text-green-700 border-green-500/30"
                    : "bg-muted text-muted-foreground"
                }
              >
                {link ? (link.active ? "Acceso activo" : "Acceso desactivado") : "Sin acceso generado"}
              </Badge>
              {link?.last_viewed_at && (
                <span className="text-[11px] text-muted-foreground">
                  Última consulta: {formatMX(link.last_viewed_at, "dd MMM yyyy HH:mm")}
                </span>
              )}
            </div>
            {link && (
              <label className="flex items-center gap-2 text-xs">
                Activo
                <Switch
                  checked={link.active}
                  onCheckedChange={(v) => toggleActive.mutate(v)}
                  disabled={toggleActive.isPending}
                />
              </label>
            )}
          </div>

          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Link2 className="h-4 w-4 mr-1" />
            {link ? "Generar nuevo enlace y código" : "Generar enlace y código"}
          </Button>
          {link && !revealed && (
            <p className="text-[11px] text-muted-foreground">
              El enlace y el código se muestran una sola vez. Si se pierden, genera unos nuevos (los anteriores dejan de
              funcionar).
            </p>
          )}

          {revealed && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
              <p className="text-xs font-medium">Compártelo con tu cliente (no se volverá a mostrar)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs break-all rounded bg-background border px-2 py-1">{revealed.url}</code>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => copy(revealed.url, "Enlace")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-sm tracking-widest rounded bg-background border px-2 py-1">{revealed.code}</code>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => copy(revealed.code, "Código")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={() => copy(message, "Mensaje")}>
                  Copiar mensaje completo
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
