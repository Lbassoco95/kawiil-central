import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Plus, Loader2, Mail, Phone, UserX, UserCheck } from "lucide-react";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { UserFormDialog } from "@/components/admin/UserFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useAreaOptions } from "@/hooks/useAreaOptions";
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
  const [deactivateTarget, setDeactivateTarget] = useState<{ userId: string; name: string; isActive: boolean } | null>(null);
  const { data: users, isLoading } = useOrgUsers();
  const { areaLabelMap } = useAreaOptions();
  const toggleActive = useToggleUserActive();

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
              <div
                key={user.id}
                className={`flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors ${!user.is_active ? "opacity-50" : ""}`}
              >
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
                    {!user.is_active && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">
                        Inactivo
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {user.email}
                    </span>
                    {user.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {user.phone}
                      </span>
                    )}
                    {user.area && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {areaLabelMap[user.area] || user.area}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={user.is_active ? "Desactivar usuario" : "Reactivar usuario"}
                  onClick={() => setDeactivateTarget({ userId: user.user_id, name: user.full_name, isActive: user.is_active })}
                >
                  {user.is_active ? <UserX className="h-3.5 w-3.5 text-destructive" /> : <UserCheck className="h-3.5 w-3.5 text-green-600" />}
                </Button>
              </div>
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

      <DeleteConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        title={deactivateTarget?.isActive ? `¿Desactivar a "${deactivateTarget?.name}"?` : `¿Reactivar a "${deactivateTarget?.name}"?`}
        description={deactivateTarget?.isActive
          ? "El usuario no podrá acceder al sistema hasta que sea reactivado."
          : "El usuario podrá acceder nuevamente al sistema."}
        onConfirm={() => {
          if (deactivateTarget) {
            toggleActive.mutate({ userId: deactivateTarget.userId, isActive: deactivateTarget.isActive });
            setDeactivateTarget(null);
          }
        }}
        isPending={toggleActive.isPending}
      />
    </Card>
  );
}
