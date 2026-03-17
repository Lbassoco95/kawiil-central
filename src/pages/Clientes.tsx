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
import { Plus, Search, Users, Mail, Phone, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useClients, useDeleteClient } from "@/hooks/useClients";
import { ClientFormDialog } from "@/components/clients/ClientFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useUserRole } from "@/hooks/useUserRole";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];

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

const Clientes = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { data: clients, isLoading } = useClients();
  const deleteClient = useDeleteClient();
  const { isAdminOrManager } = useUserRole();

  const filtered = useMemo(() => {
    if (!clients) return [];
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.rfc?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const grouped = useMemo(() => {
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

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Gestión de clientes y empresas</p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nuevo cliente
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar clientes..."
              className="pl-9 h-9 text-sm bg-secondary/30 border-0 focus-visible:ring-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-12 text-sm">Cargando...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h3 className="mt-3 text-sm font-medium text-foreground">
              {search ? "Sin resultados" : "Sin clientes aún"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {search ? "Intenta con otro término de búsqueda." : "Agrega tu primer cliente para comenzar."}
            </p>
            {!search && (
              <Button className="mt-3" size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Agregar cliente
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <Collapsible key={group.key} open={!isCollapsed} onOpenChange={() => toggleGroup(group.key)}>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-1.5 group">
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</h2>
                    <span className="text-[10px] text-muted-foreground/60">{group.clients.length}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 divide-y divide-border/40">
                      {group.clients.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-center justify-between gap-4 py-2.5 px-2 -mx-2 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer"
                          onClick={() => navigate(`/clientes/${client.id}`)}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="text-[13px] font-medium text-foreground truncate">
                                  {client.name}
                                </h3>
                                <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${STATUS_STYLES[client.status]}`}>
                                  {STATUS_LABELS[client.status]}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                                <span>
                                  {client.client_type === "persona_moral" ? "PM" : "PF"}
                                  {client.rfc && ` · ${client.rfc}`}
                                </span>
                                {client.email && (
                                  <span className="flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    {client.email}
                                  </span>
                                )}
                                {client.phone && (
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {client.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {client.services?.filter((s) => s !== group.key).map((s) => (
                              <span key={s} className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                                {SERVICE_LABELS[s as ServiceArea] || s}
                              </span>
                            ))}
                            {isAdminOrManager && (
                              <button
                                className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
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
