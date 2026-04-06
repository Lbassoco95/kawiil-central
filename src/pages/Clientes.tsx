import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Plus, Search, Users, Mail, Phone, Trash2, ChevronDown, ChevronRight, Building2, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClients, useDeleteClient } from "@/hooks/useClients";
import { useClientGroups } from "@/hooks/useClientGroups";
import { ClientFormDialog } from "@/components/clients/ClientFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUserRole } from "@/hooks/useUserRole";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];
type ClientType = Database["public"]["Enums"]["client_type"];

type ClientTypeFilter = "all" | ClientType;

import { SERVICE_LABELS } from "@/lib/serviceLabels";

import { CLIENT_STATUS_CONFIG } from "@/lib/statusStyles";

const STATUS_STYLES: Record<ClientStatus, string> = Object.fromEntries(
  Object.entries(CLIENT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
) as Record<ClientStatus, string>;

const STATUS_LABELS: Record<ClientStatus, string> = Object.fromEntries(
  Object.entries(CLIENT_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ClientStatus, string>;

const AREA_ORDER: ServiceArea[] = [
  "contabilidad", "legal", "softlanding", "pld_ft",
  "cumplimiento", "juicios", "gestoria", "constitucion_nacional",
];

type GroupMode = "area" | "grupo";

const Clientes = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("area");
  const [clientTypeFilter, setClientTypeFilter] = useState<ClientTypeFilter>("all");
  const { data: clients, isLoading } = useClients();
  const { data: clientGroups } = useClientGroups();
  const deleteClient = useDeleteClient();
  const { isAdminOrManager } = useUserRole();

  const { data: allGroupMembers } = useQuery({
    queryKey: ["all-client-group-members"],
    queryFn: async () => {
      const { data, error } = await supabase.from("client_group_members" as any).select("*");
      if (error) return [];
      return (data || []) as { group_id: string; client_id: string }[];
    },
    enabled: !!clients && groupMode === "grupo",
  });

  const filtered = useMemo(() => {
    if (!clients) return [];
    let list = clients;
    if (clientTypeFilter !== "all") {
      list = list.filter((c) => c.client_type === clientTypeFilter);
    }
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.rfc?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
    );
  }, [clients, search, clientTypeFilter]);

  const groupedByArea = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    const noService: typeof filtered = [];

    for (const client of filtered) {
      if (!client.services || client.services.length === 0) {
        noService.push(client);
        continue;
      }
      const primaryArea = client.primary_area || client.services[0];
      if (!groups[primaryArea]) groups[primaryArea] = [];
      groups[primaryArea].push(client);
    }

    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    }
    noService.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    const result: { key: string; label: string; clients: typeof filtered }[] = AREA_ORDER
      .filter((key) => groups[key] && groups[key].length > 0)
      .map((key) => ({ key, label: SERVICE_LABELS[key], clients: groups[key] }));

    if (noService.length > 0) {
      result.push({ key: "sin_servicio", label: "Sin servicio asignado", clients: noService });
    }

    return result;
  }, [filtered]);

  const groupedByEmpresa = useMemo(() => {
    if (!clientGroups || !allGroupMembers) return groupedByArea;
    const memberMap = new Map<string, string[]>();
    for (const m of allGroupMembers) {
      if (!memberMap.has(m.group_id)) memberMap.set(m.group_id, []);
      memberMap.get(m.group_id)!.push(m.client_id);
    }
    const assignedClientIds = new Set(allGroupMembers.map((m) => m.client_id));
    const filteredIds = new Set(filtered.map((c) => c.id));

    const result: { key: string; label: string; clients: typeof filtered }[] = [];
    for (const g of clientGroups) {
      const memberIds = memberMap.get(g.id) || [];
      const groupClients = filtered.filter((c) => memberIds.includes(c.id));
      if (groupClients.length > 0) {
        groupClients.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        result.push({ key: g.id, label: g.name, clients: groupClients });
      }
    }
    const ungrouped = filtered.filter((c) => !assignedClientIds.has(c.id));
    if (ungrouped.length > 0) {
      ungrouped.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      result.push({ key: "sin_grupo", label: "Sin grupo empresarial", clients: ungrouped });
    }
    return result;
  }, [filtered, clientGroups, allGroupMembers, groupedByArea]);

  const grouped = groupMode === "area" ? groupedByArea : groupedByEmpresa;

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Clientes"
          description="Gestión de clientes y empresas"
          actions={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Nuevo cliente
            </Button>
          }
        />

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar clientes..."
              className="pl-9 h-9 text-sm bg-secondary/30 border-0 focus-visible:ring-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setGroupMode("area")}
              className={`tab-pill ${groupMode === "area" ? "tab-pill-active" : "tab-pill-inactive"} inline-flex items-center gap-1`}
            >
              <Layers className="h-3 w-3" /> Área
            </button>
            <button
              onClick={() => setGroupMode("grupo")}
              className={`tab-pill ${groupMode === "grupo" ? "tab-pill-active" : "tab-pill-inactive"} inline-flex items-center gap-1`}
            >
              <Building2 className="h-3 w-3" /> Grupo
            </button>
          </div>
          <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Filtrar por tipo de persona">
            <button
              type="button"
              onClick={() => setClientTypeFilter("all")}
              className={`tab-pill ${clientTypeFilter === "all" ? "tab-pill-active" : "tab-pill-inactive"}`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setClientTypeFilter("persona_fisica")}
              className={`tab-pill ${clientTypeFilter === "persona_fisica" ? "tab-pill-active" : "tab-pill-inactive"}`}
            >
              Persona Física
            </button>
            <button
              type="button"
              onClick={() => setClientTypeFilter("persona_moral")}
              className={`tab-pill ${clientTypeFilter === "persona_moral" ? "tab-pill-active" : "tab-pill-inactive"}`}
            >
              Persona Moral
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 animate-scale-in">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-primary/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground">
              {search.trim() || clientTypeFilter !== "all" ? "Sin resultados" : "Sin clientes aún"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
              {search.trim() || clientTypeFilter !== "all"
                ? "Prueba otro término de búsqueda o cambia el filtro de tipo de persona."
                : "Agrega tu primer cliente para comenzar."}
            </p>
            {!search.trim() && clientTypeFilter === "all" && (
              <Button className="mt-4" size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Agregar cliente
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            {grouped.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <Collapsible key={group.key} open={!isCollapsed} onOpenChange={() => toggleGroup(group.key)}>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-1.5 group">
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform" />
                    )}
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</h2>
                    <span className="text-[10px] bg-secondary/60 text-muted-foreground px-1.5 py-0.5 rounded-full">{group.clients.length}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {group.clients.map((client, i) => (
                        <div
                          key={client.id}
                          className="glass-card-hover p-4 cursor-pointer animate-fade-in group/card"
                          style={{ animationDelay: `${Math.min(i, 8) * 40}ms`, animationFillMode: "both" }}
                          onClick={() => navigate(`/clientes/${client.id}`)}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="text-sm font-medium text-foreground truncate group-hover/card:text-primary transition-colors">
                              {client.name}
                            </h3>
                            <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 shrink-0 ${STATUS_STYLES[client.status]}`}>
                              {STATUS_LABELS[client.status]}
                            </Badge>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              {client.client_type === "persona_moral" ? "Persona Moral" : "Persona Física"}
                              {client.rfc && ` · ${client.rfc}`}
                            </p>
                            {client.email && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                <Mail className="h-3 w-3 shrink-0" />
                                {client.email}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            {client.services?.filter((s) => s !== group.key).map((s) => (
                              <span key={s} className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                                {SERVICE_LABELS[s as ServiceArea] || s}
                              </span>
                            ))}
                            {isAdminOrManager && (
                              <button
                                className="ml-auto p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors"
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: client.id, name: client.name }); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>

      <ClientFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar cliente "${deleteTarget?.name}"?`}
        description="Se eliminará el cliente y sus datos asociados. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteTarget) { await deleteClient.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteClient.isPending}
      />
    </AppLayout>
  );
};

export default Clientes;
