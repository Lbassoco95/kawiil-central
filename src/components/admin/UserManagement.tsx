import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Plus, Loader2, Mail, Phone, UserX, UserCheck, ChevronDown, ChevronUp, Calendar, KeyRound, Shield, MapPin } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { UserFormDialog } from "@/components/admin/UserFormDialog";
import { useAreaOptions } from "@/hooks/useAreaOptions";
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
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Gerente",
  staff: "Staff",
  viewer: "Viewer",
};

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  staff: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  viewer: "bg-muted text-muted-foreground",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

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
      toast.success(vars.isActive ? "Usuario desactivado" : "Usuario reactivado");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function UserManagement() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{ userId: string; name: string; isActive: boolean } | null>(null);
  const { data: users, isLoading } = useOrgUsers();
  const { areaLabelMap } = useAreaOptions();
  const toggleActive = useToggleUserActive();
  const [sendingReset, setSendingReset] = useState<string | null>(null);

  const handleSendRecovery = async (email: string, userId: string) => {
    setSendingReset(userId);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/cambiar-contrasena`,
      });
      if (error) throw error;
      toast.success(`Correo de recuperación enviado a ${email}`);
    } catch (e: any) {
      toast.error(e.message || "Error al enviar correo de recuperación");
    } finally {
      setSendingReset(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Usuarios del equipo
        </CardTitle>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Agregar usuario
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !users?.length ? (
          <div className="text-center py-8">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">No hay usuarios registrados</p>
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
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {getInitials(user.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{user.full_name}</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ROLE_STYLES[user.role || "staff"]}`}>
                            {ROLE_LABELS[user.role || "staff"] || user.role}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                      {expandedUser === user.id ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 pt-0 space-y-3 border-t mx-3">
                      <div className="grid grid-cols-2 gap-3 pt-3 text-sm">
                        <div>
                          <span className="text-xs text-muted-foreground block">Correo</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                            {user.email}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Teléfono</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                            {user.phone || <span className="text-muted-foreground italic">Sin registrar</span>}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Área</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {user.area ? (
                              <Badge variant="secondary" className="text-xs">
                                {areaLabelMap[user.area] || user.area}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground italic">Sin asignar</span>
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Rol</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                            <Badge variant="outline" className={`text-xs ${ROLE_STYLES[user.role || "staff"]}`}>
                              {ROLE_LABELS[user.role || "staff"] || user.role}
                            </Badge>
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Fecha de alta</span>
                          <span className="flex items-center gap-1.5 mt-0.5 text-sm">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {format(new Date(user.created_at), "d MMM yyyy", { locale: es })}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Estado</span>
                          <Badge variant="outline" className="text-xs mt-0.5 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                            Activo
                          </Badge>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1 border-t">
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
                  Usuarios inactivos ({users.filter((u) => !u.is_active).length})
                </summary>
                <div className="space-y-2 mt-2">
                  {users.filter((u) => !u.is_active).map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 rounded-lg border border-dashed p-3 opacity-50"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                          {getInitials(user.full_name)}
                        </AvatarFallback>
                      </Avatar>
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
                        title="Reactivar usuario"
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

      {deactivateTarget && (
        <AlertDialog open={true} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deactivateTarget.isActive ? `¿Desactivar a "${deactivateTarget.name}"?` : `¿Reactivar a "${deactivateTarget.name}"?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deactivateTarget.isActive
                  ? "El usuario no podrá acceder al sistema hasta que sea reactivado."
                  : "El usuario podrá acceder nuevamente al sistema."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={toggleActive.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  toggleActive.mutate({ userId: deactivateTarget.userId, isActive: deactivateTarget.isActive });
                  setDeactivateTarget(null);
                }}
                disabled={toggleActive.isPending}
                className={deactivateTarget.isActive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              >
                {toggleActive.isPending ? "Procesando..." : deactivateTarget.isActive ? "Desactivar" : "Reactivar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
