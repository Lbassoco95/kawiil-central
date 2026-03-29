import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useClientDetail } from "@/hooks/useClientDetail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Mail, Phone, MapPin, User, FileText,
  CheckSquare, FolderOpen, Pencil, Shield,
} from "lucide-react";
import { ClientProjectsTab } from "@/components/clients/ClientProjectsTab";
import { ClientEditDialog } from "@/components/clients/ClientEditDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { ComplianceClientSection } from "@/components/compliance/ComplianceClientSection";
import { DropboxFolderBrowser } from "@/components/clients/DropboxFolderBrowser";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

import { CLIENT_STATUS_CONFIG, TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";

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

const tabs: { key: string; label: string; icon?: typeof Shield }[] = [
  { key: "general", label: "General" },
  { key: "cumplimiento", label: "Cumplimiento", icon: Shield },
  { key: "proyectos", label: "Proyectos" },
  { key: "tareas", label: "Tareas" },
  { key: "documentos", label: "Documentos" },
];

const ClienteDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { client, isLoadingClient, projects, tasks, documents } = useClientDetail(id);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<string>("general");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

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

  const activeTasks = tasks.filter((t) => t.status !== "completada" && t.status !== "cancelada");

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Hero header */}
        <div className="rounded-xl bg-gradient-to-r from-primary/5 via-accent/5 to-transparent border border-border/50 p-5">
          <div className="flex items-start gap-3">
            <button onClick={() => navigate("/clientes")} className="mt-0.5 p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-white/5 transition-colors">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground truncate">{client.name}</h1>
                <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${STATUS_STYLES[client.status]}`}>
                  {STATUS_LABELS[client.status]}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {client.client_type === "persona_moral" ? "Persona Moral" : "Persona Física"}
                {client.rfc && ` · RFC: ${client.rfc}`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar
            </Button>
          </div>
        </div>

        {/* Tab pills */}
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => {
            const count = t.key === "proyectos" ? projects.length
              : t.key === "tareas" ? activeTasks.length
              : t.key === "documentos" ? documents.length : null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-pill ${tab === t.key ? "tab-pill-active" : "tab-pill-inactive"} inline-flex items-center gap-1.5`}
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
            <section>
              <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3">Contacto</h2>
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

            <section>
              <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3">Servicios</h2>
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

            <section className="md:col-span-2">
              <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
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
              <section>
                <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3">Notas</h2>
                <p className="text-[13px] whitespace-pre-wrap text-foreground">{client.notes}</p>
              </section>
            )}
          </div>
        )}

        {tab === "cumplimiento" && <ComplianceClientSection clientId={client.id} />}
        {tab === "proyectos" && <ClientProjectsTab client={client} projects={projects} />}

        {/* Tasks */}
        {tab === "tareas" && (
          activeTasks.length === 0 ? (
            <div className="text-center py-16">
              <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Sin tareas pendientes.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {activeTasks.map((t) => (
                <div key={t.id} onClick={() => setSelectedTaskId(t.id)} className="flex items-center justify-between gap-3 py-3 px-1 cursor-pointer hover:bg-secondary/30 rounded-md transition-colors">
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
          )
        )}

        {/* Documents */}
        {tab === "documentos" && (
          documents.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Sin documentos asociados.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 py-3 px-1">
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
