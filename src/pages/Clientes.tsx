import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

const STATUS_STYLES: Record<ClientStatus, string> = {
  activo: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  inactivo: "bg-muted text-muted-foreground",
  prospecto: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

const STATUS_LABELS: Record<ClientStatus, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  prospecto: "Prospecto",
};

const AREA_ORDER: ServiceArea[] = [
  "contabilidad",
  "legal",
  "softlanding",
  "pld_ft",
  "juicios",
  "gestoria",
  "constitucion_nacional",
];

const Clientes = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { data: clients, isLoading } = useClients();
  const deleteClient = useDeleteClient();

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
      // Use primary_area if set, otherwise first service
      const primaryArea = client.primary_area || client.services[0];
      if (!groups[primaryArea]) groups[primaryArea] = [];
      groups[primaryArea].push(client);
    }

    // Sort alphabetically within each group
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
            <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
            <p className="text-sm text-muted-foreground">
              Gestión de clientes y empresas
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo cliente
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar clientes..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Badge variant="secondary" className="text-xs">
            {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-center text-muted-foreground py-8">Cargando...</p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <div className="text-center py-12">
                <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-medium text-foreground">
                  {search ? "Sin resultados" : "Sin clientes aún"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search
                    ? "Intenta con otro término de búsqueda."
                    : "Agrega tu primer cliente para comenzar."}
                </p>
                {!search && (
                  <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar cliente
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <Collapsible key={group.key} open={!isCollapsed} onOpenChange={() => toggleGroup(group.key)}>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-accent/50 rounded-md transition-colors">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
                    <Badge variant="secondary" className="text-xs ml-1">
                      {group.clients.length}
                    </Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid gap-2 mt-2 ml-6">
                      {group.clients.map((client) => (
                        <Card
                          key={client.id}
                          className="hover:shadow-md transition-shadow cursor-pointer"
                          onClick={() => navigate(`/clientes/${client.id}`)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-foreground truncate text-sm">
                                      {client.name}
                                    </h3>
                                    <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[client.status]}`}>
                                      {STATUS_LABELS[client.status]}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
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
                                  <Badge key={s} variant="secondary" className="text-[10px]">
                                    {SERVICE_LABELS[s as ServiceArea] || s}
                                  </Badge>
                                ))}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                                  onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: client.id, name: client.name }); }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
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
