import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Users, Plus, Loader2, Mail, Phone, UserX, UserCheck, ChevronDown, ChevronUp, Calendar, KeyRound, Shield, MapPin, Pencil, RefreshCw, Send, Link2, KeySquare, CheckCircle2, ImageDown } from "lucide-react";
import { useBackfillOrgPhotos } from "@/hooks/useMicrosoft";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatMX } from "@/lib/dateUtils";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { UserFormDialog } from "@/components/admin/UserFormDialog";
import { UserEditDialog } from "@/components/admin/UserEditDialog";
import { useUserModulePermissions, MODULE_LABELS, MODULE_KEYS } from "@/hooks/useModulePermissions";
import type { OrgUser, OnboardingStatus } from "@/hooks/useOrgUsers";
import { useAreaOptions, formatCelulaLabel } from "@/hooks/useAreaOptions";
import { gradoLabel, gradoBadgeClass } from "@/lib/gradoLabels";
import type { AppGrado } from "@/lib/gradoLabels";
import {
  parseKawiilerPermissions,
  effectiveCanDeleteTasks,
  effectiveCanEditTaskDueDates,
} from "@/lib/kawiilerPermissions";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeUserMessageAsync, invokeFunctionWithSession } from "@/lib/supabaseInvoke";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function UserCelulaBadges({ userId, fallbackArea, areaLabelMap }: { userId: string; fallbackArea?: string | null; areaLabelMap: Record<string, string> }) {
  const { data: celulas, isLoading } = useQuery({
    queryKey: ["user-celulas-display", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_celulas")
        .select("celula_id, celulas!inner(name, color, slug)")
        .eq("user_id", userId);
      if (error) return [];
      return (data || []).map((uc: any) => ({
        name: uc.celulas?.name,
        color: uc.celulas?.color || "#6366f1",
        slug: uc.celulas?.slug,
      }));
    },
  });

  if (isLoading) return <span className="text-muted-foreground italic text-xs">Cargando...</span>;
  if (!celulas?.length) {
    if (fallbackArea) {
      return <Badge variant="secondary" className="text-xs">{formatCelulaLabel(fallbackArea, areaLabelMap)}</Badge>;
    }
    return <span className="text-muted-foreground italic">Sin asignar</span>;
  }

  return (
    <>
      {celulas.map((c) => (
        <Badge key={c.slug} variant="secondary" className="text-xs" style={{ borderLeft: `3px solid ${c.color}` }}>
          {c.name}
        </Badge>
      ))}
    </>
  );
}

function UserTaskPermissionBadges({ user }: { user: OrgUser }) {
  const r = (user.role || "ejecutor") as AppGrado;
  if (r !== "referente" && r !== "transformador") {
    return <span className="text-[10px] text-muted-foreground italic">No aplica a este grado</span>;
  }
  const p = parseKawiilerPermissions(user.kawiiler_permissions);
  const del = effectiveCanDeleteTasks(r, p);
  const due = effectiveCanEditTaskDueDates(r, p);
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={del ? "secondary" : "outline"} className="text-[9px] px-1.5 py-0">
        Eliminar tareas: {del ? "sí" : "no"}
      </Badge>
      <Badge variant={due ? "secondary" : "outline"} className="text-[9px] px-1.5 py-0">
        Fechas límite: {due ? "sí" : "no"}
      </Badge>
    </div>
  );
}

function UserModuleBadges({ userId }: { userId: string }) {
  const { data: modules = {}, isLoading } = useUserModulePermissions(userId);
  if (isLoading) return null;
  const active = MODULE_KEYS.filter((k) => modules[k]);
  if (!active.length) return <span className="text-[10px] text-muted-foreground italic">Sin módulos</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((k) => (
        <Badge key={k} variant="secondary" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
          {MODULE_LABELS[k]}
        </Badge>
      ))}
    </div>
  );
}

const ONBOARDING_CONFIG: Record<OnboardingStatus, { label: string; className: string; icon: typeof Send }> = {
  invited: {
    label: "Invitación enviada",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300",
    icon: Send,
  },
  link_opened: {
    label: "Enlace abierto",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300",
    icon: Link2,
  },
  password_set: {
    label: "Contraseña establecida",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-300",
    icon: KeySquare,
  },
  active: {
    label: "Registrado",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300",
    icon: CheckCircle2,
  },
};

function useToggleUserActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: !isActive })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["org-profiles"] });
      toast.success(vars.isActive ? "Kawiiler desactivado" : "Kawiiler reactivado");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function UserManagement() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{ userId: string; name: string; isActive: boolean } | null>(null);
  const [editTarget, setEditTarget] = useState<OrgUser | null>(null);
  const { data: users, isLoading } = useOrgUsers();
  const { areaLabelMap } = useAreaOptions();
  const toggleActive = useToggleUserActive();
  const [sendingReset, setSendingReset] = useState<string | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const backfillPhotos = useBackfillOrgPhotos();

  const handleSendRecovery = async (email: string, userId: string) => {
    setSendingReset(userId);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/cambiar-contrasena?flow=direct`,
      });
      if (error) throw error;
      toast.success(`Correo de recuperación enviado a ${email}`);
    } catch (e: any) {
      toast.error(e.message || "Error al enviar correo de recuperación");
    } finally {
      setSendingReset(null);
    }
  };

  const handleResendInvite = async (userId: string, email: string) => {
    setResendingInvite(userId);
    try {
      const { data, error } = await invokeFunctionWithSession<{
        rate_limited?: boolean;
        message?: string;
        error?: string;
        success?: boolean;
      }>("resend-invite", { user_id: userId });
      if (error) {
        toast.error(await functionInvokeUserMessageAsync(data, error));
        return;
      }
      if (data?.rate_limited) {
        toast.error(data.message || "Debes esperar antes de reenviar nuevamente");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success(data?.message || `Invitación reenviada a ${email}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al reenviar invitación");
    } finally {
      setResendingInvite(null);
    }
  };

  return (
    <Card variant="glass">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Equipo Kawiil
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => backfillPhotos.mutate()}
            disabled={backfillPhotos.isPending}
            title="Trae las fotos de perfil desde Microsoft 365 para todos los usuarios conectados"
          >
            {backfillPhotos.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ImageDown className="h-4 w-4 mr-1" />
            )}
            Sincronizar fotos
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Agregar Kawiiler
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !users?.length ? (
          <div className="text-center py-8">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">No hay Kawiilers registrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.filter((u) => u.is_active).map((user) => (
              <Collapsible
                key={user.id}
                open={expandedUser === user.id}
                onOpenChange={(open) => setExpandedUser(open ? user.id : null)}
              >
                <div className="rounded-lg border hover:bg-muted/30 transition-colors">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-3 w-full p-3 text-left">
                      <UserAvatar
                        name={user.full_name}
                        email={user.email}
                        avatarUrl={user.avatar_url}
                        userId={user.user_id}
                        size="lg"
                        className="h-9 w-9"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{user.full_name}</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${gradoBadgeClass(user.role || "ejecutor")}`}>
                            {gradoLabel(user.role || "ejecutor")}
                          </Badge>
                          {(() => {
                            const raw = user.onboarding_status || (user.invitation_accepted ? 'active' : 'invited');
                            const status = (raw in ONBOARDING_CONFIG ? raw : 'invited') as OnboardingStatus;
                            const config = ONBOARDING_CONFIG[status];
                            const StatusIcon = config.icon;
                            return (
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.className}`}>
                                <StatusIcon className="h-3 w-3 mr-0.5" />
                                {config.label}
                              </Badge>
                            );
                          })()}
                        </div>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[11px] px-2 py-1 h-7 shrink-0 text-primary border-primary/30 hover:bg-primary/10"
                        disabled={resendingInvite === user.user_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResendInvite(user.user_id, user.email);
                        }}
                      >
                        {resendingInvite === user.user_id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        )}
                        Reenviar
                      </Button>
                      {expandedUser === user.id ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 pt-0 space-y-3 border-t mx-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 text-sm">
                        <div>
                          <span className="text-xs text-muted-foreground block">Correo</span>
                          <span className="flex items-center gap-1.5 mt-0.5 break-all">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {user.email}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Teléfono</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {user.phone || <span className="text-muted-foreground italic">Sin registrar</span>}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Células</span>
                          <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <UserCelulaBadges userId={user.user_id} fallbackArea={user.area} areaLabelMap={areaLabelMap} />
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Grado</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <Badge variant="outline" className={`text-xs ${gradoBadgeClass(user.role || "ejecutor")}`}>
                              {gradoLabel(user.role || "ejecutor")}
                            </Badge>
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Fecha de alta</span>
                          <span className="flex items-center gap-1.5 mt-0.5 text-sm">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {formatMX(user.created_at, "d MMM yyyy")}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Registro</span>
                          {(() => {
                            const raw = user.onboarding_status || (user.invitation_accepted ? "active" : "invited");
                            const status = (raw in ONBOARDING_CONFIG ? raw : "invited") as OnboardingStatus;
                            const config = ONBOARDING_CONFIG[status];
                            const StatusIcon = config.icon;
                            return (
                              <Badge variant="outline" className={`text-xs mt-0.5 ${config.className}`}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {config.label}
                              </Badge>
                            );
                          })()}
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Cuenta</span>
                          <Badge
                            variant="outline"
                            className={
                              user.is_active
                                ? "text-xs mt-0.5 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300"
                                : "text-xs mt-0.5 bg-muted text-muted-foreground"
                            }
                          >
                            {user.is_active ? "Activa" : "Inactiva"}
                          </Badge>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-xs text-muted-foreground block mb-1">Módulos</span>
                          <UserModuleBadges userId={user.user_id} />
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-xs text-muted-foreground block mb-1">Permisos de tareas</span>
                          <UserTaskPermissionBadges user={user} />
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 pt-1 border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditTarget(user);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Editar
                        </Button>
                        {(user.onboarding_status || (user.invitation_accepted ? 'active' : 'invited')) !== 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-primary"
                            disabled={resendingInvite === user.user_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResendInvite(user.user_id, user.email);
                            }}
                          >
                            {resendingInvite === user.user_id ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5 mr-1" />
                            )}
                            Reenviar enlace inicial
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          disabled={sendingReset === user.user_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSendRecovery(user.email, user.user_id);
                          }}
                        >
                          {sendingReset === user.user_id ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <KeyRound className="h-3.5 w-3.5 mr-1" />
                          )}
                          Enviar recuperación
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeactivateTarget({ userId: user.user_id, name: user.full_name, isActive: true });
                          }}
                        >
                          <UserX className="h-3.5 w-3.5 mr-1" />
                          Desactivar
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}

            {/* Inactive users section */}
            {users.filter((u) => !u.is_active).length > 0 && (
              <details className="mt-4">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground py-2">
                  Kawiilers inactivos ({users.filter((u) => !u.is_active).length})
                </summary>
                <div className="space-y-2 mt-2">
                  {users.filter((u) => !u.is_active).map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 rounded-lg border border-dashed p-3 opacity-50"
                    >
                      <UserAvatar
                        name={user.full_name}
                        email={user.email}
                        avatarUrl={user.avatar_url}
                        userId={user.user_id}
                        size="lg"
                        className="h-9 w-9 grayscale"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{user.full_name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">
                            Inactivo
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Reactivar Kawiiler"
                        onClick={() => setDeactivateTarget({ userId: user.user_id, name: user.full_name, isActive: false })}
                      >
                        <UserCheck className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>

      <UserFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <UserEditDialog user={editTarget} open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)} />

      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivateTarget?.isActive ? "¿Desactivar Kawiiler?" : "¿Reactivar Kawiiler?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.isActive
                ? `"${deactivateTarget?.name}" no podrá acceder al sistema hasta que sea reactivado.`
                : `"${deactivateTarget?.name}" podrá volver a acceder al sistema.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateTarget) {
                  toggleActive.mutate(
                    { userId: deactivateTarget.userId, isActive: deactivateTarget.isActive },
                    { onSuccess: () => setDeactivateTarget(null) }
                  );
                }
              }}
            >
              {deactivateTarget?.isActive ? "Desactivar" : "Reactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
