import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];
type Client = Tables<"clients">;
type Project = Tables<"projects">;

import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { PROJECT_STATUS_CONFIG } from "@/lib/statusStyles";

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
) as Record<ProjectStatus, string>;

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ProjectStatus, string>;

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

  if (services.includes("nomina")) {
    expected.push({ area: "nomina", namePrefix: "Nómina" });
  }

  // PLD/FT project
  if (services.includes("pld_ft")) {
    expected.push({ area: "pld_ft", namePrefix: "Cumplimiento PLD/FT" });
  }

  // Gestoría project (RFC + e.firma)
  if (services.includes("gestoria")) {
    expected.push({ area: "gestoria", namePrefix: "Gestoría" });
  }

  // Constitución Nacional project
  if (services.includes("constitucion_nacional")) {
    expected.push({ area: "constitucion_nacional", namePrefix: "Constitución Nacional" });
  }

  // Juicios – individual lawsuits are added manually

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

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const projectIdsKey = projectIds.slice().sort().join(",");

  const { data: taskRows = [] } = useQuery({
    queryKey: ["client-projects-task-stats", client.id, projectIdsKey],
    enabled: projectIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("project_id, status")
        .in("project_id", projectIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const statsByProject = useMemo(() => {
    const m = new Map<string, { total: number; pending: number }>();
    for (const row of taskRows) {
      if (!row.project_id) continue;
      const cur = m.get(row.project_id) ?? { total: 0, pending: 0 };
      cur.total += 1;
      if (row.status !== "completada") cur.pending += 1;
      m.set(row.project_id, cur);
    }
    return m;
  }, [taskRows]);

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
        <div className="space-y-2">
          {projects.map((p, i) => {
            const stats = statsByProject.get(p.id);
            const pct = p.status === "completado"
              ? 100
              : !stats || stats.total === 0
                ? 0
                : Math.round(((stats.total - stats.pending) / stats.total) * 100);
            const barColor =
              p.status === "completado"
                ? "bg-green-600"
                : p.status === "pausado"
                  ? "bg-amber-500"
                  : p.status === "cancelado"
                    ? "bg-muted-foreground/40"
                    : "bg-accent";
            return (
              <div
                key={p.id}
                className="grid grid-cols-12 gap-4 items-center py-3 px-4 page-list-card cursor-pointer animate-fade-in"
                style={{ animationDelay: `${Math.min(i, 10) * 30}ms`, animationFillMode: "both" }}
                onClick={() => navigate(`/proyectos/${p.id}`)}
              >
                {/* Col 1-6: nombre + descripción + meta */}
                <div className="col-span-12 md:col-span-6 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {p.area && (
                      <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                        {SERVICE_LABELS[p.area]}
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-medium text-foreground truncate">{p.name}</h4>
                  {p.description && (
                    <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                      {p.description}
                    </p>
                  )}
                  {stats && stats.total > 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Tareas:{" "}
                      <span className="text-foreground font-medium">
                        {stats.pending}/{stats.total} pend.
                      </span>
                    </div>
                  )}
                </div>

                {/* Col 7-10: progreso con label */}
                <div className="col-span-8 md:col-span-4">
                  <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-1">
                    Progreso <span className="tabular-nums text-foreground">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", barColor)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Col 11-12: status */}
                <div className="col-span-4 md:col-span-2 flex items-center justify-end gap-2">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] border-0 px-1.5 py-0", PROJECT_STATUS_STYLES[p.status])}
                  >
                    {PROJECT_STATUS_LABELS[p.status]}
                  </Badge>
                </div>
              </div>
            );
          })}
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
