import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Plus, Loader2, Mail, Phone } from "lucide-react";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { UserFormDialog } from "@/components/admin/UserFormDialog";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type AppRole = Database["public"]["Enums"]["app_role"];

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

const AREA_LABELS: Record<ServiceArea, string> = {
  contabilidad: "Contabilidad",
  legal: "Legal",
  softlanding: "Soft Landing",
  pld_ft: "PLD/FT",
  juicios: "Juicios",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function UserManagement() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: users, isLoading } = useOrgUsers();

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
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors"
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
                        {AREA_LABELS[user.area as ServiceArea] || user.area}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <UserFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
