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
import { Plus, Search, Users, Mail, Trash2, ChevronDown, ChevronRight, Building2, Download, User2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClients, useDeleteClient } from "@/hooks/useClients";
import { useClientGroups } from "@/hooks/useClientGroups";
import { ClientFormDialog } from "@/components/clients/ClientFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { useSavioFinanceApiData } from "@/hooks/useSavioFinanceApi";
import { clientSavioLinkStatus } from "@/lib/clientSavioLink";
import { avatarGradient } from "@/lib/avatarGradient";
import { useClientStats } from "@/hooks/useClientStats";
import { exportClientsCsv } from "@/lib/exportClients";
import { toast } from "sonner";
import type { PageHeaderStat } from "@/components/shared/PageHeader";
import { AiHeroGrid } from "@/components/dashboard/AiHeroGrid";
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

/** Vista de Clientes: agrupar por TIPO de persona (PM / PF / Prospectos) o por
 * GRUPO empresarial. Intencionalmente NO se agrupa por "área de servicio" —
 * eso es la lógica del módulo Proyectos, no de Clientes. */
type GroupMode = "tipo" | "grupo";

function clientInitials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

const TYPE_GROUP_LABELS: Record<ClientType, string> = {
  persona_moral: "Personas morales",
  persona_fisica: "Personas físicas",
};

const TYPE_GROUP_ORDER: ClientType[] = ["persona_moral", "persona_fisica"];

const SERVICE_AREA_COLOR_VAR: Partial<Record<ServiceArea, string>> = {
  contabilidad: "var(--area-contabilidad)",
  legal: "var(--area-legal)",
  softlanding: "var(--area-softlanding)",
  pld_ft: "var(--area-pld)",
};

function serviceAreaDotColor(area: ServiceArea | string): string {
  const v = SERVICE_AREA_COLOR_VAR[area as ServiceArea];
  return v ? `hsl(${v})` : "hsl(var(--primary))";
}

const Clientes = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasFinanceAccess, isLoading: financeAccessLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioIncomeLoading } = useSavioIncomeAccess();
  const showSavioListHints =
    !!user && hasFinanceAccess && canViewSavioIncome && !financeAccessLoading && !savioIncomeLoading;
  const { customerRows, isLoading: savioCustomersLoading } = useSavioFinanceApiData({
    fetchEnabled: showSavioListHints,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("tipo");
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

  const groupedByType = useMemo(() => {
    const buckets: Record<ClientType, typeof filtered> = {
      persona_moral: [],
      persona_fisica: [],
    };
    const prospectos: typeof filtered = [];

    for (const client of filtered) {
      if (client.status === "prospecto") {
        prospectos.push(client);
        continue;
      }
      buckets[client.client_type].push(client);
    }

    const sortByName = (a: typeof filtered[number], b: typeof filtered[number]) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase());

    for (const k of Object.keys(buckets) as ClientType[]) {
      buckets[k].sort(sortByName);
    }
    prospectos.sort(sortByName);

    const result: { key: string; label: string; clients: typeof filtered }[] = [];
    for (const key of TYPE_GROUP_ORDER) {
      if (buckets[key].length > 0) {
        result.push({ key, label: TYPE_GROUP_LABELS[key], clients: buckets[key] });
      }
    }
    if (prospectos.length > 0) {
      result.push({ key: "prospectos", label: "Prospectos", clients: prospectos });
    }
    return result;
  }, [filtered]);

  function savioBadgeForClient(c: (typeof filtered)[number]) {
    if (c.savio_customer_id?.trim()) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] border-emerald-500/40 text-emerald-800 dark:text-emerald-200 shrink-0"
        >
          Savio
        </Badge>
      );
    }
    if (!showSavioListHints || savioCustomersLoading) return null;
    const { status } = clientSavioLinkStatus(c, customerRows);
    if (status === "rfc_suggest") {
      return (
        <Badge
          variant="outline"
          className="text-[10px] border-amber-500/45 text-amber-900 dark:text-amber-200 shrink-0"
        >
          RFC Savio
        </Badge>
      );
    }
    if (status === "no_link") {
      return (
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground border-border bg-muted/30 shrink-0"
        >
          Sin Savio
        </Badge>
      );
    }
    return null;
  }

  const groupedByEmpresa = useMemo(() => {
    if (!clientGroups || !allGroupMembers) return groupedByType;
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
  }, [filtered, clientGroups, allGroupMembers, groupedByType]);

  const grouped = groupMode === "tipo" ? groupedByType : groupedByEmpresa;

  const typeCounts = useMemo(() => {
    const base = clients ?? [];
    return {
      all: base.length,
      persona_fisica: base.filter((c) => c.client_type === "persona_fisica").length,
      persona_moral: base.filter((c) => c.client_type === "persona_moral").length,
    };
  }, [clients]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const stats = useClientStats();

  const heroStats = useMemo<Array<PageHeaderStat | false>>(() => {
    const totalActivos = stats.activos ?? 0;
    const subActivos =
      stats.activosMorales != null && stats.activosFisicas != null
        ? `${stats.activosMorales} morales · ${stats.activosFisicas} físicas`
        : undefined;
    const pctOk =
      totalActivos > 0 && stats.alCorriente != null
        ? `${Math.round((stats.alCorriente / totalActivos) * 100)}% de la cartera${
            stats.alCorrienteConSavio != null && stats.alCorrienteConSavio > 0
              ? ` · ${stats.alCorrienteConSavio} con Savio`
              : ""
          }`
        : undefined;
    const ingresosFmt =
      stats.ingresosMes != null
        ? new Intl.NumberFormat("es-MX", {
            style: "currency",
            currency: "MXN",
            maximumFractionDigits: 0,
          }).format(stats.ingresosMes)
        : null;
    const facturasSub =
      stats.facturasEmitidas != null
        ? `${stats.facturasEmitidas} factura${stats.facturasEmitidas === 1 ? "" : "s"} emitida${stats.facturasEmitidas === 1 ? "" : "s"}`
        : undefined;

    return [
      stats.activos != null && {
        label: "Activos",
        value: stats.activos,
        sub: subActivos,
        tone: "default" as const,
      },
      stats.alCorriente != null && {
        label: "Al corriente",
        value: stats.alCorriente,
        sub: pctOk,
        tone: "success" as const,
      },
      stats.requierenAtencion != null && {
        label: "Requieren atención",
        value: stats.requierenAtencion,
        sub: "CSF, 32-D, contrato",
        tone: "warning" as const,
      },
      stats.onboarding != null && {
        label: "Onboarding",
        value: stats.onboarding,
        sub: "Altas nuevas este mes",
        tone: "primary" as const,
      },
      ingresosFmt != null && {
        label: "Ingresos mes",
        value: ingresosFmt,
        sub: facturasSub,
        tone: "default" as const,
      },
    ];
  }, [stats]);

  const handleExport = () => {
    if (!filtered.length) {
      toast.error("Sin clientes que exportar con los filtros actuales.");
      return;
    }
    exportClientsCsv(filtered);
    toast.success(`Exportados ${filtered.length} cliente${filtered.length === 1 ? "" : "s"} a CSV.`);
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Trabajo", "Clientes"]}
          icon={<Users />}
          iconAccent="linear-gradient(135deg, hsl(340 80% 55%), hsl(15 85% 60%))"
          title="Clientes"
          description="Tu cartera completa: empresas, personas físicas y prospectos. Conectados con Moffin, Savio y el SAT."
          stats={heroStats}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={handleExport}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar
              </Button>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Nuevo cliente
              </Button>
            </>
          }
        />

        <AiHeroGrid
          module="clientes"
          clientes={{
            activos: stats.activos,
            alCorriente: stats.alCorriente,
            requierenAtencion: stats.requierenAtencion,
            onboarding: stats.onboarding,
            attentionList: stats.attentionList,
            onExport: handleExport,
          }}
        />

        <div className="surface-toolbar space-y-3 p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar clientes..."
                className="pl-9 h-9 text-sm bg-background/60 border border-border/50 focus-visible:ring-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setGroupMode("tipo")}
                className={`tab-pill ${groupMode === "tipo" ? "tab-pill-active" : "tab-pill-inactive"} inline-flex items-center gap-1 whitespace-nowrap`}
                title="Agrupar por tipo de persona"
              >
                <User2 className="h-3 w-3 shrink-0" /> Tipo
              </button>
              <button
                type="button"
                onClick={() => setGroupMode("grupo")}
                className={`tab-pill ${groupMode === "grupo" ? "tab-pill-active" : "tab-pill-inactive"} inline-flex items-center gap-1 whitespace-nowrap`}
                title="Agrupar por grupo empresarial"
              >
                <Building2 className="h-3 w-3 shrink-0" /> Grupo
              </button>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Filtrar por tipo de persona"
          >
            {(
              [
                { value: "all" as const, label: "Todos", count: typeCounts.all },
                { value: "persona_fisica" as const, label: "Persona Física", count: typeCounts.persona_fisica },
                { value: "persona_moral" as const, label: "Persona Moral", count: typeCounts.persona_moral },
              ] as const
            ).map(({ value, label, count }) => {
              const active = clientTypeFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setClientTypeFilter(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
                      active ? "bg-primary/15" : "bg-muted/60",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-secondary/30 animate-pulse" />
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
                    <div className="mt-2 space-y-2">
                      {group.clients.map((client, i) => {
                        const services = client.services || [];
                        const visibleServices = services.slice(0, 3);
                        const extraServices = services.length - visibleServices.length;
                        return (
                          <div
                            key={client.id}
                            className="page-list-card flex items-center gap-3 px-4 py-3 cursor-pointer animate-fade-in group/card"
                            style={{ animationDelay: `${Math.min(i, 8) * 30}ms`, animationFillMode: "both" }}
                            onClick={() => navigate(`/clientes/${client.id}`)}
                          >
                            {/* Avatar */}
                            <div
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/30 dark:ring-white/10"
                              style={{ background: avatarGradient(client.name) }}
                              aria-hidden
                            >
                              {clientInitials(client.name)}
                            </div>

                            {/* Name + meta */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h3 className="text-sm font-medium text-foreground truncate group-hover/card:text-primary transition-colors">
                                  {client.name}
                                </h3>
                                {client.status === "activo" ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                    <span className="relative inline-flex h-1.5 w-1.5">
                                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
                                      <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    </span>
                                    Activo
                                  </span>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className={cn("text-[10px] border-0 px-1.5 py-0 shrink-0", STATUS_STYLES[client.status])}
                                  >
                                    {STATUS_LABELS[client.status]}
                                  </Badge>
                                )}
                                {savioBadgeForClient(client)}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                <span>
                                  {client.client_type === "persona_moral" ? "Persona Moral" : "Persona Física"}
                                </span>
                                {client.rfc && (
                                  <span className="font-mono tabular-nums">RFC · {client.rfc}</span>
                                )}
                                {client.email && (
                                  <span className="hidden md:inline-flex items-center gap-1 truncate max-w-[220px]">
                                    <Mail className="h-3 w-3 shrink-0" />
                                    {client.email}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Service area chips */}
                            <div className="hidden lg:flex items-center gap-1 shrink-0">
                              {visibleServices.map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex items-center gap-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  <span
                                    className="inline-block h-1.5 w-1.5 rounded-full"
                                    style={{ background: serviceAreaDotColor(s as ServiceArea) }}
                                    aria-hidden
                                  />
                                  {SERVICE_LABELS[s as ServiceArea] || s}
                                </span>
                              ))}
                              {extraServices > 0 && (
                                <span className="text-[10px] text-muted-foreground bg-secondary/40 px-1.5 py-0.5 rounded">
                                  +{extraServices}
                                </span>
                              )}
                            </div>

                            {isAdminOrManager && (
                              <button
                                className="p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors shrink-0"
                                aria-label={`Eliminar ${client.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget({ id: client.id, name: client.name });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
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
