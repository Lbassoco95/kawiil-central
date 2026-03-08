import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useClientDetail } from "@/hooks/useClientDetail";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  User,
  FileText,
  CheckSquare,
  FolderOpen,
  Pencil,
  Shield,
} from "lucide-react";
import { ClientProjectsTab } from "@/components/clients/ClientProjectsTab";
import { ClientEditDialog } from "@/components/clients/ClientEditDialog";
import { ComplianceClientSection } from "@/components/compliance/ComplianceClientSection";
import { DropboxFolderBrowser } from "@/components/clients/DropboxFolderBrowser";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

const STATUS_STYLES: Record<ClientStatus, string> = {
  activo: "bg-success/10 text-success",
  inactivo: "bg-muted text-muted-foreground",
  prospecto: "bg-warning/10 text-warning",
};

const STATUS_LABELS: Record<ClientStatus, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  prospecto: "Prospecto",
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  en_revision: "En revisión",
  completada: "Completada",
  cancelada: "Cancelada",
};

const TASK_PRIORITY_STYLES: Record<TaskPriority, string> = {
  urgente: "bg-destructive/10 text-destructive",
  alta: "bg-warning/10 text-warning",
  media: "bg-primary/10 text-primary",
  baja: "bg-muted text-muted-foreground",
};

const ClienteDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { client, isLoadingClient, projects, tasks, documents } = useClientDetail(id);
  const [editOpen, setEditOpen] = useState(false);

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <button onClick={() => navigate("/clientes")} className="mt-1 p-1 rounded-lg hover:bg-secondary/60 transition-colors">
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

        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="cumplimiento">
              <Shield className="h-3.5 w-3.5 mr-1" />
              Cumplimiento
            </TabsTrigger>
            <TabsTrigger value="proyectos">Proyectos ({projects.length})</TabsTrigger>
            <TabsTrigger value="tareas">Tareas ({activeTasks.length})</TabsTrigger>
            <TabsTrigger value="documentos">Documentos ({documents.length})</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Contact Info */}
              <section>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Información de contacto</h2>
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

              {/* Services */}
              <section>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Servicios contratados</h2>
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

              {/* Dropbox */}
              <section className="md:col-span-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Carpeta Dropbox
                </h2>
                {client.dropbox_folder_path ? (
                  <DropboxFolderBrowser folderPath={client.dropbox_folder_path} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sin carpeta de Dropbox vinculada. Edita el cliente para agregar la ruta.
                  </p>
                )}
              </section>

              {/* Notes */}
              {client.notes && (
                <section>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Notas</h2>
                  <p className="text-[13px] whitespace-pre-wrap text-foreground">{client.notes}</p>
                </section>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cumplimiento">
            <ComplianceClientSection clientId={client.id} />
          </TabsContent>

          <TabsContent value="proyectos">
            <ClientProjectsTab client={client} projects={projects} />
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tareas">
            {activeTasks.length === 0 ? (
              <div className="text-center py-16">
                <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Sin tareas pendientes para este cliente.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {activeTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-3 px-1">
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
            )}
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documentos">
            {documents.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Sin documentos asociados a este cliente.</p>
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
            )}
          </TabsContent>
        </Tabs>
      </div>

      <ClientEditDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
    </AppLayout>
  );
};

export default ClienteDetalle;
