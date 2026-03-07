import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useClientDetail } from "@/hooks/useClientDetail";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  ExternalLink,
  FolderOpen,
  Pencil,
  Shield,
} from "lucide-react";
import { ClientProjectsTab } from "@/components/clients/ClientProjectsTab";
import { ClientEditDialog } from "@/components/clients/ClientEditDialog";
import { ComplianceClientSection } from "@/components/compliance/ComplianceClientSection";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientStatus = Database["public"]["Enums"]["client_status"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type TaskPriority = Database["public"]["Enums"]["task_priority"];

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

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  en_revision: "En revisión",
  completada: "Completada",
  cancelada: "Cancelada",
};

const TASK_PRIORITY_STYLES: Record<TaskPriority, string> = {
  urgente: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  alta: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  media: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
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
        <p className="text-center text-muted-foreground py-12">Cargando...</p>
      </AppLayout>
    );
  }

  if (!client) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Cliente no encontrado</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/clientes")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
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
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/clientes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground truncate">{client.name}</h1>
              <Badge variant="outline" className={STATUS_STYLES[client.status]}>
                {STATUS_LABELS[client.status]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {client.client_type === "persona_moral" ? "Persona Moral" : "Persona Física"}
              {client.rfc && ` · RFC: ${client.rfc}`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
        </div>

        <Tabs defaultValue="general" className="space-y-4">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="cumplimiento">
              <Shield className="h-4 w-4 mr-1" />
              Cumplimiento
            </TabsTrigger>
            <TabsTrigger value="proyectos">
              Proyectos ({projects.length})
            </TabsTrigger>
            <TabsTrigger value="tareas">
              Tareas ({activeTasks.length})
            </TabsTrigger>
            <TabsTrigger value="documentos">
              Documentos ({documents.length})
            </TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Contact Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Información de contacto</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {client.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <a href={`mailto:${client.email}`} className="text-primary hover:underline">
                        {client.email}
                      </a>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{client.phone}</span>
                    </div>
                  )}
                  {client.address && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{client.address}</span>
                    </div>
                  )}
                  {client.contact_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>
                        {client.contact_name}
                        {client.contact_position && ` — ${client.contact_position}`}
                      </span>
                    </div>
                  )}
                  {!client.email && !client.phone && !client.address && !client.contact_name && (
                    <p className="text-sm text-muted-foreground">Sin información de contacto</p>
                  )}
                </CardContent>
              </Card>

              {/* Services */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Servicios contratados</CardTitle>
                </CardHeader>
                <CardContent>
                  {client.services && client.services.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {client.services.map((s) => (
                        <Badge key={s} variant="secondary">
                          {SERVICE_LABELS[s as ServiceArea] || s}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sin servicios asignados</p>
                  )}
                  {client.primary_area && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Área principal: <strong>{SERVICE_LABELS[client.primary_area]}</strong>
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Dropbox */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Carpeta Dropbox
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {client.dropbox_folder_path ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate flex-1">{client.dropbox_folder_path}</span>
                      <a
                        href={`https://www.dropbox.com/home${client.dropbox_folder_path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Abrir
                        </Button>
                      </a>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Sin carpeta de Dropbox vinculada. Edita el cliente para agregar la ruta.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Notes */}
              {client.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Notas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
                  </CardContent>
                </Card>
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
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sin tareas pendientes para este cliente.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {activeTasks.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="font-medium text-foreground truncate">{t.title}</h4>
                          {t.due_date && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Vence: {formatDateMX(t.due_date)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className={TASK_PRIORITY_STYLES[t.priority]}>
                            {t.priority}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {TASK_STATUS_LABELS[t.status]}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documentos">
            {documents.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="mx-auto h-10 w-10 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sin documentos asociados a este cliente.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {documents.map((d) => (
                  <Card key={d.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">{d.name}</span>
                        </div>
                        {d.document_type && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {d.document_type}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
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
