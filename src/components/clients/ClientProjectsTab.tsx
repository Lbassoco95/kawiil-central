import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderKanban, Plus, Zap } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];
type Client = Tables<"clients">;
type Project = Tables<"projects">;

import { SERVICE_LABELS } from "@/lib/serviceLabels";

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  activo: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pausado: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completado: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelado: "bg-muted text-muted-foreground",
};

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  completado: "Completado",
  cancelado: "Cancelado",
};

/**
 * Maps contracted services to the projects that should be auto-created.
 * Backoffice (contabilidad+legal) and Softlanding both include a Contabilidad project.
 */
function getExpectedProjects(services: ServiceArea[]): Array<{ area: ServiceArea; namePrefix: string }> {
  const expected: Array<{ area: ServiceArea; namePrefix: string }> = [];

  // Contabilidad project for contabilidad or softlanding
  if (services.includes("contabilidad") || services.includes("softlanding")) {
    expected.push({
      area: services.includes("softlanding") ? "softlanding" : "contabilidad",
      namePrefix: "Contabilidad",
    });
  }

  // Legal project
  if (services.includes("legal")) {
    expected.push({ area: "legal", namePrefix: "Legal" });
  }

  // PLD/FT project
  if (services.includes("pld_ft")) {
    expected.push({ area: "pld_ft", namePrefix: "Cumplimiento PLD/FT" });
  }

  // Juicios – individual lawsuits are added manually
  // (not auto-created since each lawsuit is unique)

  return expected;
}

interface ClientProjectsTabProps {
  client: Client;
  projects: Project[];
}

export function ClientProjectsTab({ client, projects }: ClientProjectsTabProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [additionalDialogOpen, setAdditionalDialogOpen] = useState(false);
  const [additionalName, setAdditionalName] = useState("");
  const [additionalDescription, setAdditionalDescription] = useState("");

  const expectedProjects = getExpectedProjects(client.services || []);

  // Find which expected projects don't exist yet (match by area)
  const missingProjects = expectedProjects.filter(
    (ep) => !projects.some((p) => p.area === ep.area && p.status !== "cancelado")
  );

  const createServiceProjects = useMutation({
    mutationFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

      for (const proj of missingProjects) {
        const { error } = await supabase.from("projects").insert({
          name: `${proj.namePrefix} - ${client.name}`,
          client_id: client.id,
          area: proj.area,
          organization_id: orgId!,
          created_by: user!.id,
          responsible_user_id: client.responsible_user_id || user!.id,
          tax_obligations: [],
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-projects", client.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`${missingProjects.length} proyecto(s) creado(s) exitosamente`);
    },
    onError: (error) => toast.error("Error al crear proyectos: " + error.message),
  });

  const createAdditionalProject = useMutation({
    mutationFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { error } = await supabase.from("projects").insert({
        name: `${additionalName} - ${client.name}`,
        client_id: client.id,
        organization_id: orgId!,
        created_by: user!.id,
        responsible_user_id: client.responsible_user_id || user!.id,
        description: additionalDescription || null,
        tax_obligations: [],
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-projects", client.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Proyecto adicional creado");
      setAdditionalDialogOpen(false);
      setAdditionalName("");
      setAdditionalDescription("");
    },
    onError: (error) => toast.error("Error: " + error.message),
  });

  return (
    <>
      {/* Action bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {missingProjects.length > 0 && (
          <Button
            onClick={() => createServiceProjects.mutate()}
            disabled={createServiceProjects.isPending}
            size="sm"
          >
            <Zap className="mr-2 h-4 w-4" />
            {createServiceProjects.isPending
              ? "Creando..."
              : `Crear proyectos del servicio (${missingProjects.length})`}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdditionalDialogOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Proyecto adicional
        </Button>
      </div>

      {/* Missing projects info */}
      {missingProjects.length > 0 && (
        <Card className="mb-4 border-dashed border-primary/40">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-2">
              Proyectos pendientes de crear según servicios contratados:
            </p>
            <div className="flex flex-wrap gap-2">
              {missingProjects.map((mp) => (
                <Badge key={mp.area} variant="outline" className="text-xs">
                  {mp.namePrefix}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing projects */}
      {projects.length === 0 && missingProjects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sin proyectos asociados a este cliente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <Card
              key={p.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/proyectos/${p.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="font-medium text-foreground truncate">{p.name}</h4>
                    {p.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.area && (
                      <Badge variant="secondary" className="text-xs">
                        {SERVICE_LABELS[p.area]}
                      </Badge>
                    )}
                    <Badge variant="outline" className={PROJECT_STATUS_STYLES[p.status]}>
                      {PROJECT_STATUS_LABELS[p.status]}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Additional project dialog */}
      <Dialog open={additionalDialogOpen} onOpenChange={setAdditionalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proyecto adicional</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Crea un proyecto fuera de los servicios contratados (ej. Registro de marca, trámite especial).
            Se nombrará automáticamente como "<strong>{additionalName || "Nombre"} - {client.name}</strong>".
          </p>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="additional-name">Nombre del proyecto *</Label>
              <Input
                id="additional-name"
                placeholder="Ej. Registro de marca, Trámite migratorio..."
                value={additionalName}
                onChange={(e) => setAdditionalName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <Textarea
                placeholder="Detalles del proyecto..."
                value={additionalDescription}
                onChange={(e) => setAdditionalDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdditionalDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => createAdditionalProject.mutate()}
                disabled={!additionalName.trim() || createAdditionalProject.isPending}
              >
                {createAdditionalProject.isPending ? "Creando..." : "Crear proyecto"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
