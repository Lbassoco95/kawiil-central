import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useClientDetail } from "@/hooks/useClientDetail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Mail, Phone, MapPin, User, FileText,
  CheckSquare, FolderOpen, Pencil, Shield, Building2, ChevronRight, Landmark,
} from "lucide-react";
import { ClientProjectsTab } from "@/components/clients/ClientProjectsTab";
import { ClientEditDialog } from "@/components/clients/ClientEditDialog";
import { ClientHealthScoreCard } from "@/components/clients/ClientHealthScoreCard";
import { ClientSatFiscalSection } from "@/components/clients/ClientSatFiscalSection";
import { ClientSatCertificatesSection } from "@/components/clients/ClientSatCertificatesSection";
import { MoffinSatStatusSummary } from "@/components/clients/MoffinSatStatusSummary";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { ComplianceClientSection } from "@/components/compliance/ComplianceClientSection";
import { DropboxFolderBrowser } from "@/components/clients/DropboxFolderBrowser";
import { useClientGroupsForClient } from "@/hooks/useClientGroups";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

import { CLIENT_STATUS_CONFIG, TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { TeamVisibilityBanner } from "@/components/shared/TeamVisibilityBanner";
import { useOpenTaskAssigneeUserIds } from "@/hooks/useOpenTaskAssigneeUserIds";
import { useClientCollaboratorIds } from "@/hooks/useClientCollaborators";
import { useProfiles } from "@/hooks/useTasks";
import { useAuth } from "@/contexts/AuthContext";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { useSavioFinanceApiData } from "@/hooks/useSavioFinanceApi";
import { ClientSavioFinanceSection } from "@/components/clients/ClientSavioFinanceSection";
import { clientSavioLinkStatus } from "@/lib/clientSavioLink";

const STATUS_STYLES: Record<ClientStatus, string> = Object.fromEntries(
  Object.entries(CLIENT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
) as Record<ClientStatus, string>;

const STATUS_LABELS: Record<ClientStatus, string> = Object.fromEntries(
  Object.entries(CLIENT_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ClientStatus, string>;

const TASK_STATUS_LABELS: Record<TaskStatus, string> = Object.fromEntries(
  Object.entries(TASK_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<TaskStatus, string>;

const TASK_PRIORITY_STYLES: Record<TaskPriority, string> = Object.fromEntries(
  Object.entries(PRIORITY_CONFIG).map(([k, v]) => [k, v.color])
) as Record<TaskPriority, string>;

const baseTabs: { key: string; label: string; icon?: typeof Shield }[] = [
  { key: "general", label: "General" },
  { key: "cumplimiento", label: "Cumplimiento", icon: Shield },
  { key: "proyectos", label: "Proyectos" },
  { key: "tareas", label: "Tareas" },
  { key: "documentos", label: "Documentos" },
];

const ClienteDetalle = () => {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { client, isLoadingClient, projects, tasks, documents } = useClientDetail(id);
  const { data: clientGroupsList } = useClientGroupsForClient(id);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<string>("general");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { hasFinanceAccess, isLoading: financeAccessLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioIncomeLoading } = useSavioIncomeAccess();
  const showSavioTab =
    !!user && hasFinanceAccess && canViewSavioIncome && !financeAccessLoading && !savioIncomeLoading;

  const savioHintsQuery = useSavioFinanceApiData({
    fetchEnabled: showSavioTab && (tab === "cobranza" || !client?.savio_customer_id?.trim()),
  });

  const activeTasks = useMemo(
    () => tasks.filter((t) => !isTaskClosedStatus(t.status)),
    [tasks]
  );
  const closedTasks = useMemo(() => {
    const list = tasks.filter((t) => isTaskClosedStatus(t.status));
    return [...list].sort(
      (a, b) =>
        new Date(b.updated_at || "").getTime() - new Date(a.updated_at || "").getTime()
    );
  }, [tasks]);

  const openTasks = useMemo(() => tasks.filter((t) => !isTaskClosedStatus(t.status)), [tasks]);
  const openTaskIds = useMemo(() => openTasks.map((t) => t.id), [openTasks]);
  const { data: taskAssigneeUserIds = [], isLoading: loadingTaskAssignees } = useOpenTaskAssigneeUserIds(openTaskIds);
  const { data: declaredCollaboratorIds = [], isLoading: loadingDeclaredCollaborators } = useClientCollaboratorIds(id);
  const { data: orgProfiles = [] } = useProfiles();
  const profilesByUserId = useMemo(
    () => new Map(orgProfiles.map((p) => [p.user_id, p])),
    [orgProfiles]
  );

  const clientCollaboratorUserIds = useMemo(() => {
    const responsible = client?.responsible_user_id;
    const explicit = new Set(declaredCollaboratorIds);
    const set = new Set<string>();
    for (const uid of declaredCollaboratorIds) set.add(uid);
    for (const t of openTasks) {
      if (t.assigned_to) set.add(t.assigned_to);
    }
    for (const uid of taskAssigneeUserIds) set.add(uid);
    for (const p of projects) {
      if (p.status === "activo" || p.status === "pausado") {
        if (p.responsible_user_id) set.add(p.responsible_user_id);
      }
    }
    if (responsible) set.delete(responsible);
    return [...set].sort((a, b) => {
      const aExplicit = explicit.has(a) ? 0 : 1;
      const bExplicit = explicit.has(b) ? 0 : 1;
      if (aExplicit !== bExplicit) return aExplicit - bExplicit;
      const na = profilesByUserId.get(a)?.full_name || "";
      const nb = profilesByUserId.get(b)?.full_name || "";
      return na.localeCompare(nb, "es");
    });
  }, [
    client?.responsible_user_id,
    declaredCollaboratorIds,
    openTasks,
    taskAssigneeUserIds,
    projects,
    profilesByUserId,
  ]);

  if (isLoadingClient) {
    return (
      <AppLayout>
        <p className="text-center text-muted-foreground py-12 text-sm">Cargando...</p>
      </AppLayout>
    );
  }

  if (!client) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Cliente no encontrado</p>
          <Button variant="outline" className="mt-4" size="sm" onClick={() => navigate("/clientes")}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Volver
          </Button>
        </div>
      </AppLayout>
    );
  }

  const tabsToShow = showSavioTab
    ? [...baseTabs, { key: "cobranza", label: "Cobranza (Savio)", icon: Landmark }]
    : baseTabs;

  const savioBanner = clientSavioLinkStatus(
    {
      id: client.id,
      name: client.name,
      rfc: client.rfc,
      savio_customer_id: client.savio_customer_id,
    },
    savioHintsQuery.customerRows,
  );

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Hero header */}
        <div className="glass-card relative overflow-hidden p-5">
          <div className="absolute inset-0 opacity-[0.07] bg-gradient-to-br from-primary to-accent pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <button onClick={() => navigate("/clientes")} className="mt-0.5 p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-white/5 transition-colors">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight gradient-text truncate">{client.name}</h1>
                <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${STATUS_STYLES[client.status]}`}>
                  {STATUS_LABELS[client.status]}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {client.client_type === "persona_moral" ? "Persona Moral" : "Persona Física"}
                {client.rfc && ` · RFC: ${client.rfc}`}
              </p>
              {showSavioTab && savioBanner.status === "no_link" && (
                <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                  Sin enlace Savio. {savioBanner.suggestedSavioIds.length > 0
                    ? "Hay coincidencia por RFC en la lista de clientes Savio: enlaza en Editar cliente."
                    : "Configura el id de cliente Savio en Editar cliente."}
                </p>
              )}
              {showSavioTab && savioBanner.status === "rfc_suggest" && (
                <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                  Hay cliente(s) Savio con el mismo RFC. Abre <strong className="font-medium">Editar</strong> y elige el
                  vínculo correcto.
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar
            </Button>
          </div>
          <TeamVisibilityBanner
            responsibleHeading="Responsable del cliente"
            responsibleUserId={client.responsible_user_id}
            profilesByUserId={profilesByUserId}
            collaboratorUserIds={clientCollaboratorUserIds}
            collaboratorsLoading={
              (loadingTaskAssignees && openTaskIds.length > 0) || (loadingDeclaredCollaborators && !!id)
            }
            collaboratorsEmptyHint="No hay colaboradores de seguimiento en la ficha ni otras personas en tareas abiertas, colaboradores de tareas o responsables de proyectos activos o en pausa. Configura el equipo en Editar cliente."
            className="relative"
          />
        </div>

        {/* Tab pills */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1 flex-nowrap">
          {tabsToShow.map((t) => {
            const count = t.key === "proyectos" ? projects.length
              : t.key === "tareas" ? activeTasks.length
              : t.key === "documentos" ? documents.length : null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-pill ${tab === t.key ? "tab-pill-active" : "tab-pill-inactive"} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
              >
                {t.icon && <t.icon className="h-3 w-3" />}
                {t.label}
                {count !== null && <span className={`text-[10px] ${tab === t.key ? "opacity-80" : "opacity-60"}`}>{count}</span>}
              </button>
            );
          })}
        </div>

        {/* General Tab */}
        {tab === "general" && (
          <div className="grid gap-6 md:grid-cols-2 animate-fade-in">
            <div className="md:col-span-2">
              <ClientHealthScoreCard
                client={client}
                projects={projects}
                tasks={tasks}
                documents={documents as any}
              />
            </div>
            <MoffinSatStatusSummary clientId={client.id} className="glass-card md:col-span-2" />

            <section className="glass-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Contacto</h2>
              <div className="space-y-2.5">
                {client.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={`mailto:${client.email}`} className="text-primary hover:underline text-[13px]">{client.email}</a>
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center gap-2 text-[13px]">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {client.address && (
                  <div className="flex items-center gap-2 text-[13px]">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{client.address}</span>
                  </div>
                )}
                {client.contact_name && (
                  <div className="flex items-center gap-2 text-[13px]">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{client.contact_name}{client.contact_position && ` — ${client.contact_position}`}</span>
                  </div>
                )}
                {!client.email && !client.phone && !client.address && !client.contact_name && (
                  <p className="text-sm text-muted-foreground">Sin información de contacto</p>
                )}
              </div>
            </section>

            {clientGroupsList && clientGroupsList.length > 0 && (
              <section className="glass-card p-5">
                <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Grupo empresarial
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {clientGroupsList.map((g) => (
                    <span key={g.id} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                      {g.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="glass-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Servicios</h2>
              {client.services && client.services.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {client.services.map((s) => (
                    <span key={s} className="text-xs bg-secondary/60 text-foreground px-2 py-1 rounded-full">
                      {SERVICE_LABELS[s as ServiceArea] || s}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sin servicios asignados</p>
              )}
              {client.primary_area && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Área principal: <strong>{SERVICE_LABELS[client.primary_area]}</strong>
                </p>
              )}
            </section>

            <ClientSatFiscalSection client={client} projects={projects} />

            <ClientSatCertificatesSection
              clientId={client.id}
              clientRfc={client.rfc ?? null}
            />

            <section className="md:col-span-2 glass-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                Carpeta Dropbox
              </h2>
              {client.dropbox_folder_path ? (
                <DropboxFolderBrowser folderPath={client.dropbox_folder_path} />
              ) : (
                <p className="text-sm text-muted-foreground">Sin carpeta vinculada.</p>
              )}
            </section>

            {client.notes && (
              <section className="glass-card p-5 md:col-span-2">
                <h2 className="text-sm font-medium text-muted-foreground mb-3">Notas</h2>
                <p className="text-[13px] whitespace-pre-wrap text-foreground">{client.notes}</p>
              </section>
            )}
          </div>
        )}

        {tab === "cumplimiento" && <ComplianceClientSection clientId={client.id} />}
        {tab === "cobranza" && showSavioTab && (
          <div className="glass-card p-5 animate-fade-in">
            <h2 className="text-sm font-medium text-muted-foreground mb-4">Cobranza Savio</h2>
            <ClientSavioFinanceSection client={client} savioCustomerRowsForHints={savioHintsQuery.customerRows} />
          </div>
        )}
        {tab === "proyectos" && <ClientProjectsTab client={client} projects={projects} />}

        {/* Tasks */}
        {tab === "tareas" && (
          <div className="space-y-3">
            {activeTasks.length === 0 && closedTasks.length === 0 ? (
              <div className="text-center py-16">
                <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Sin tareas para este cliente.</p>
              </div>
            ) : (
              <>
                {activeTasks.length > 0 ? (
                  <div className="glass-card divide-y divide-border/30 overflow-hidden">
                    <p className="text-[11px] text-muted-foreground px-4 py-2 bg-muted/20">En curso</p>
                    {activeTasks.map((t) => (
                      <div key={t.id} onClick={() => setSelectedTaskId(t.id)} className="flex items-center justify-between gap-3 py-3 px-4 cursor-pointer hover:bg-secondary/20 transition-colors duration-200">
                        <div className="min-w-0">
                          <h4 className="text-[13px] font-medium text-foreground truncate">{t.title}</h4>
                          {t.due_date && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">Vence: {formatDateMX(t.due_date)}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${TASK_PRIORITY_STYLES[t.priority]}`}>
                            {t.priority}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                            {TASK_STATUS_LABELS[t.status]}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin tareas en curso.</p>
                )}

                {closedTasks.length > 0 && (
                  <Collapsible defaultOpen={false} className="group rounded-xl border border-border/40 overflow-hidden bg-muted/10 [&[data-state=open]]:border-border/60">
                    <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
                      <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                      Historial — completadas o canceladas ({closedTasks.length})
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="divide-y divide-border/30 border-t border-border/30">
                        {closedTasks.map((t) => (
                          <div
                            key={t.id}
                            onClick={() => setSelectedTaskId(t.id)}
                            className="flex items-center justify-between gap-3 py-3 px-4 cursor-pointer hover:bg-secondary/20 transition-colors duration-200 opacity-85"
                          >
                            <div className="min-w-0">
                              <h4 className={cn("text-[13px] font-medium truncate text-muted-foreground", t.status === "cancelada" && "line-through")}>
                                {t.title}
                              </h4>
                              {t.due_date && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">Vence: {formatDateMX(t.due_date)}</p>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                              {TASK_STATUS_LABELS[t.status]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </>
            )}
          </div>
        )}

        {/* Documents */}
        {tab === "documentos" && (
          documents.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Sin documentos asociados.</p>
            </div>
          ) : (
            <div className="glass-card divide-y divide-border/30 overflow-hidden">
              {documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 py-3 px-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[13px] font-medium text-foreground truncate">{d.name}</span>
                  </div>
                  {d.document_type && (
                    <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                      {d.document_type}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <ClientEditDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
      <TaskDetailDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </AppLayout>
  );
};

export default ClienteDetalle;
