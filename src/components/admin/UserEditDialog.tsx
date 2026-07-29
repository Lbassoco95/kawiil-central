import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCelulas } from "@/hooks/useCatalogs";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OrgUser } from "@/hooks/useOrgUsers";
import { GRADO_SELECT_OPTIONS } from "@/lib/gradoLabels";
import type { AppGrado } from "@/lib/gradoLabels";
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { useUserCelulas, useSyncUserCelulas } from "@/hooks/useUserCelulas";
import {
  MODULE_KEYS,
  MODULE_LABELS,
  useUserModulePermissions,
  useSyncModulePermissions,
} from "@/hooks/useModulePermissions";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgSettings, canActAsOrgPermissionsSteward } from "@/hooks/useOrgSettings";
import {
  useFinanceIncomeViewerForUser,
  useSetFinanceIncomeViewer,
} from "@/hooks/useFinanceIncomeViewer";
import {
  parseKawiilerPermissions,
  taskPermissionDefaultsForRole,
} from "@/lib/kawiilerPermissions";

const editSchema = z.object({
  full_name: z.string().trim().min(1, "El nombre es requerido").max(200),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  area: z.string().optional().or(z.literal("")),
  role: z.enum(["en_formacion", "ejecutor", "referente", "transformador"] as const),
});

type EditFormValues = z.infer<typeof editSchema>;

interface UserEditDialogProps {
  user: OrgUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      profileData,
      role,
    }: {
      userId: string;
      profileData: {
        full_name: string;
        phone?: string | null;
        area?: string | null;
        kawiiler_permissions?: Record<string, boolean>;
      };
      role: string;
    }) => {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: profileData.full_name,
          phone: profileData.phone || null,
          area: (profileData.area || null) as any,
          ...(profileData.kawiiler_permissions != null
            ? { kawiiler_permissions: profileData.kawiiler_permissions as any }
            : {}),
        })
        .eq("user_id", userId);
      if (profileError) throw profileError;

      const { error: roleError } = await supabase
        .from("user_roles")
        .upsert(
          { user_id: userId, role: role as any },
          { onConflict: "user_id" }
        );
      if (roleError) throw roleError;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["org-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["profile-kawiiler-permissions", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["user-role", vars.userId] });
    },
  });
}

export function UserEditDialog({ user, open, onOpenChange }: UserEditDialogProps) {
  const { user: authUser } = useAuth();
  const { settings: orgSettings } = useOrgSettings();
  const { data: celulas = [] } = useCelulas();
  const activeCelulas = celulas.filter((c) => c.is_active);
  const updateUser = useUpdateUser();
  const syncCelulas = useSyncUserCelulas();
  const { data: userCelulas = [] } = useUserCelulas(user?.user_id);
  const [selectedCelulaIds, setSelectedCelulaIds] = useState<string[]>([]);
  const { data: userModules = {} } = useUserModulePermissions(user?.user_id);
  const syncModules = useSyncModulePermissions();
  const [moduleState, setModuleState] = useState<Record<string, boolean>>({});
  const { isAdminOrManager, isTransformador } = useUserRole();
  const canManageModulePermissions =
    isTransformador && canActAsOrgPermissionsSteward(orgSettings, authUser?.id);
  const { data: savioViewerRow } = useFinanceIncomeViewerForUser(user?.user_id);
  const setSavioViewer = useSetFinanceIncomeViewer();
  const [savioIncomeEnabled, setSavioIncomeEnabled] = useState(false);
  const [savioWriteEnabled, setSavioWriteEnabled] = useState(false);
  const [taskDeleteEnabled, setTaskDeleteEnabled] = useState(false);
  const [taskDueDatesEnabled, setTaskDueDatesEnabled] = useState(false);
  const [globalClientAccessEnabled, setGlobalClientAccessEnabled] = useState(false);
  const editQueryClient = useQueryClient();

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      full_name: "",
      phone: "",
      area: "",
      role: "ejecutor",
    },
  });

  useEffect(() => {
    if (user && open) {
      const grado = (user.role as AppGrado) || "ejecutor";
      form.reset({
        full_name: user.full_name,
        phone: user.phone || "",
        area: user.area || "",
        role: grado,
      });
      setSelectedCelulaIds(userCelulas.map((uc) => uc.celula_id));
      const ms: Record<string, boolean> = {};
      for (const k of MODULE_KEYS) ms[k] = !!userModules[k];
      setModuleState(ms);
      setSavioIncomeEnabled(savioViewerRow?.enabled ?? false);
      setSavioWriteEnabled(savioViewerRow?.canWriteSavio ?? false);
      const defs = taskPermissionDefaultsForRole(grado);
      const stored = parseKawiilerPermissions(user.kawiiler_permissions);
      setTaskDeleteEnabled(stored.can_delete_tasks ?? !!defs.can_delete_tasks);
      setTaskDueDatesEnabled(stored.can_edit_task_due_dates ?? !!defs.can_edit_task_due_dates);
      setGlobalClientAccessEnabled(!!(user as { has_global_client_access?: boolean }).has_global_client_access);
    }
  }, [user, open, form, userCelulas, userModules, savioViewerRow]);

  const toggleCelula = (celulaId: string) => {
    setSelectedCelulaIds((prev) =>
      prev.includes(celulaId)
        ? prev.filter((id) => id !== celulaId)
        : [...prev, celulaId]
    );
  };

  const onSubmit = async (values: EditFormValues) => {
    if (!user) return;

    const primaryCelula = activeCelulas.find((c) => selectedCelulaIds.includes(c.id));
    const primaryArea = primaryCelula?.slug || values.area || null;
    const grado = values.role as AppGrado;
    const kawiiler_permissions =
      grado === "referente" || grado === "transformador"
        ? { can_delete_tasks: taskDeleteEnabled, can_edit_task_due_dates: taskDueDatesEnabled }
        : { can_delete_tasks: false, can_edit_task_due_dates: false };

    try {
      await updateUser.mutateAsync({
        userId: user.user_id,
        profileData: {
          full_name: values.full_name,
          phone: values.phone || null,
          area: primaryArea,
          kawiiler_permissions,
        },
        role: values.role,
      });

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user.user_id)
        .single();

      if (profile) {
        await syncCelulas.mutateAsync({
          userId: user.user_id,
          celulaIds: selectedCelulaIds,
          organizationId: profile.organization_id,
        });

        if (canManageModulePermissions) {
          await syncModules.mutateAsync({
            userId: user.user_id,
            organizationId: profile.organization_id,
            modules: moduleState,
          });
        }

        if (isAdminOrManager) {
          const savioEffective = !!moduleState.finanzas && savioIncomeEnabled;
          await setSavioViewer.mutateAsync({
            userId: user.user_id,
            organizationId: profile.organization_id,
            enabled: savioEffective,
            canWriteSavio: savioEffective && savioWriteEnabled,
          });

          // RF-06: acceso global a la cartera de clientes.
          const { error: globalAccessError } = await supabase
            .from("profiles" as any)
            .update({ has_global_client_access: globalClientAccessEnabled } as any)
            .eq("user_id", user.user_id);
          if (globalAccessError) throw globalAccessError;
          editQueryClient.invalidateQueries({ queryKey: ["global-client-access-user-ids"] });
        }
      }

      toast.success("Cambios guardados");
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "No se pudieron guardar los cambios";
      toast.error(message);
    }
  };

  const roleValue = form.watch("role");
  const showTaskPerms = roleValue === "referente" || roleValue === "transformador";

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo *</FormLabel>
                  <FormControl>
                    <Input placeholder="Juan Pérez" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl>
                    <Input placeholder="+52 999 123 4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Grado *</FormLabel>
                  <Select
                    onValueChange={(v) => {
                      field.onChange(v);
                      const d = taskPermissionDefaultsForRole(v as AppGrado);
                      setTaskDeleteEnabled(!!d.can_delete_tasks);
                      setTaskDueDatesEnabled(!!d.can_edit_task_due_dates);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GRADO_SELECT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="area"
              render={() => (
                <FormItem>
                  <FormLabel>Células asignadas</FormLabel>
                  <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-2">
                    {activeCelulas.length === 0 && (
                      <p className="text-xs text-muted-foreground">No hay células disponibles</p>
                    )}
                    {activeCelulas.map((cel) => (
                      <label
                        key={cel.id}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={selectedCelulaIds.includes(cel.id)}
                          onCheckedChange={() => toggleCelula(cel.id)}
                        />
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: cel.color || "#6366f1" }}
                        />
                        {cel.name}
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-1">
              <p className="text-sm font-semibold">Permisos del Kawiiler</p>
              <p className="text-xs text-muted-foreground">
                Activa o quita accesos por persona. Los módulos controlan menús y rutas; las tareas y Finanzas aplican
                según el grado y los interruptores siguientes.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Módulos de la aplicación</label>
              {!canManageModulePermissions && (
                <Alert className="mt-2">
                  <Info className="h-4 w-4" />
                  <AlertTitle className="text-sm">Solo lectura</AlertTitle>
                  <AlertDescription className="text-xs">
                    {isTransformador
                      ? "Solo el administrador de permisos designado en la organización puede cambiar módulos aquí."
                      : "Solo un transformador con permiso de administración de permisos puede activar o desactivar módulos."}
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2 border rounded-md p-2 mt-1.5">
                {MODULE_KEYS.map((key) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-sm">
                    <span>{MODULE_LABELS[key]}</span>
                    <Switch
                      checked={!!moduleState[key]}
                      disabled={!canManageModulePermissions}
                      onCheckedChange={(checked) =>
                        setModuleState((prev) => {
                          const next = { ...prev, [key]: checked };
                          if (key === "finanzas" && !checked) {
                            setSavioIncomeEnabled(false);
                          }
                          return next;
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            {showTaskPerms && (
              <div className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Tareas y equipos</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Solo para grado Referente o Transformador. Define si puede eliminar tareas de otros o cambiar
                    fechas de entrega en proyectos.
                  </p>
                </div>
                {!isAdminOrManager && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle className="text-sm">Solo lectura</AlertTitle>
                    <AlertDescription className="text-xs">
                      Solo un Referente o Transformador con acceso de gestión puede cambiar estos permisos.
                    </AlertDescription>
                  </Alert>
                )}
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Eliminar tareas (equipos / proyectos)</span>
                  <Switch
                    checked={taskDeleteEnabled}
                    disabled={!isAdminOrManager}
                    onCheckedChange={setTaskDeleteEnabled}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Modificar fechas límite de tareas</span>
                  <Switch
                    checked={taskDueDatesEnabled}
                    disabled={!isAdminOrManager}
                    onCheckedChange={setTaskDueDatesEnabled}
                  />
                </label>
              </div>
            )}

            {showTaskPerms && isAdminOrManager && <Separator />}

            {isAdminOrManager && (
              <div className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Cartera de clientes</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Con «Acceso global» el usuario aparece como colaborador en todos los clientes
                    (sin desplazar al responsable), sin crear una asignación por cliente.
                  </p>
                </div>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Acceso global a toda la cartera</span>
                  <Switch
                    checked={globalClientAccessEnabled}
                    onCheckedChange={setGlobalClientAccessEnabled}
                  />
                </label>
              </div>
            )}

            {isAdminOrManager && <Separator />}

            {isAdminOrManager && (
              <div className="rounded-md border border-border/80 bg-muted/30 p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Finanzas del usuario</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    El módulo &quot;Finanzas&quot; arriba controla el acceso al menú. Los atajos ajustan también
                    si ve solo gastos o también ingresos Savio (CXC). El rol «admin» en la aplicación Savio no se
                    sincroniza con Kawiil: quien sea <strong className="text-foreground">Transformador</strong> y tenga
                    «Ver ingresos / Savio» puede usar escritura Savio sin activar el segundo interruptor; otros roles
                    sí requieren «Crear cargos y registrar pagos».
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    disabled={!canManageModulePermissions}
                    onClick={() => {
                      setModuleState((prev) => ({ ...prev, finanzas: true }));
                      setSavioIncomeEnabled(false);
                      setSavioWriteEnabled(false);
                    }}
                  >
                    Solo gastos
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    disabled={!canManageModulePermissions}
                    onClick={() => {
                      setModuleState((prev) => ({ ...prev, finanzas: true }));
                      setSavioIncomeEnabled(true);
                      setSavioWriteEnabled(false);
                    }}
                  >
                    Gastos + ingresos Savio
                  </Button>
                </div>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Ver ingresos / Savio en Finanzas</span>
                  <Switch
                    checked={savioIncomeEnabled}
                    disabled={!moduleState.finanzas}
                    onCheckedChange={(v) => {
                      setSavioIncomeEnabled(v);
                      if (!v) setSavioWriteEnabled(false);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Crear cargos y registrar pagos (Savio)</span>
                  <Switch
                    checked={savioWriteEnabled}
                    disabled={!moduleState.finanzas || !savioIncomeEnabled}
                    onCheckedChange={setSavioWriteEnabled}
                  />
                </label>
                {savioIncomeEnabled && !savioWriteEnabled && (
                  <p className="text-[11px] text-muted-foreground">
                    Sin esta opción solo puede consultar listados y resúmenes; no verá los botones de escritura en
                    Ingresos facturados.
                  </p>
                )}
                {!moduleState.finanzas && savioIncomeEnabled && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Activa el módulo Finanzas para poder guardar el acceso a ingresos.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
