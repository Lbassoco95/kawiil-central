import { useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Trash2, ExternalLink } from "lucide-react";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFormDialog } from "@/components/actividades/ActivityFormDialog";
import { ActivityItemsCard } from "@/components/actividades/ActivityItemsCard";
import { ActivityAttendeesCard } from "@/components/actividades/ActivityAttendeesCard";
import { ActivityProvidersCard } from "@/components/actividades/ActivityProvidersCard";
import { useActivity, useDeleteActivity } from "@/hooks/useActivities";
import { useProfiles } from "@/hooks/useTasks";
import {
  activityTypeLabel, activityStatusLabel, ACTIVITY_STATUS_STYLES, type ActivityStatus,
} from "@/lib/activityTypes";
import { formatMxn } from "@/lib/pipelineFormat";
import { formatDateMX } from "@/lib/dateUtils";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right">{children}</span>
  </div>
);

const ActividadDetalle = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: activity, isLoading } = useActivity(id);
  const { data: profiles } = useProfiles();
  const deleteActivity = useDeleteActivity();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) {
    return (
      <AppLayout>
        <p className="text-center text-muted-foreground py-12">Cargando...</p>
      </AppLayout>
    );
  }

  if (!activity) {
    return <Navigate to="/actividades" replace />;
  }

  const responsibleName =
    (profiles || []).find((p) => p.user_id === activity.responsible_user_id)?.full_name || "—";

  const saldo =
    activity.budget_estimated != null
      ? (activity.budget_estimated || 0) - (activity.budget_spent || 0)
      : null;

  return (
    <AppLayout>
      <div className="kwv24 space-y-6 animate-fade-in">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/actividades")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Actividades
          </Button>
          <div className="flex items-center gap-1.5">
            <ActivityFormDialog
              activity={activity}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Editar
                </Button>
              }
            />
            <Button
              variant="ghost" size="sm" className="text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{activity.name}</h1>
            <p className="text-sm text-muted-foreground">{activityTypeLabel(activity.activity_type)}</p>
          </div>
          <Badge variant="outline" className={ACTIVITY_STATUS_STYLES[activity.status as ActivityStatus]}>
            {activityStatusLabel(activity.status)}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-3 items-start">
          <Card className="md:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Detalles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Fecha">{activity.event_date ? formatDateMX(activity.event_date) : "—"}</Row>
              <Row label="Sede / Lugar">{activity.location || "—"}</Row>
              <Row label="Responsable">{responsibleName}</Row>
              <Row label="Presupuesto estimado">{formatMxn(activity.budget_estimated, { compact: false })}</Row>
              <Row label="Gasto real">{formatMxn(activity.budget_spent, { compact: false })}</Row>
              {saldo != null && <Row label="Saldo">{formatMxn(saldo, { compact: false })}</Row>}
              {activity.dropbox_url && (
                <Row label="Dropbox">
                  <a
                    href={activity.dropbox_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Abrir <ExternalLink className="h-3 w-3" />
                  </a>
                </Row>
              )}
              {activity.notes && (
                <div className="pt-2 border-t">
                  <p className="text-muted-foreground mb-1">Notas</p>
                  <p className="whitespace-pre-wrap">{activity.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="md:col-span-2">
            <Tabs defaultValue="pendientes">
              <TabsList>
                <TabsTrigger value="pendientes">Pendientes</TabsTrigger>
                <TabsTrigger value="asistentes">Asistentes</TabsTrigger>
                <TabsTrigger value="proveedores">Proveedores</TabsTrigger>
              </TabsList>
              <TabsContent value="pendientes" className="mt-4">
                <ActivityItemsCard activityId={activity.id} />
              </TabsContent>
              <TabsContent value="asistentes" className="mt-4">
                <ActivityAttendeesCard activityId={activity.id} />
              </TabsContent>
              <TabsContent value="proveedores" className="mt-4">
                <ActivityProvidersCard activityId={activity.id} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Eliminar actividad"
        description="Se eliminará la actividad y todos sus pendientes. Esta acción no se puede deshacer."
        isPending={deleteActivity.isPending}
        onConfirm={() =>
          deleteActivity.mutate(activity.id, { onSuccess: () => navigate("/actividades") })
        }
      />
    </AppLayout>
  );
};

export default ActividadDetalle;
