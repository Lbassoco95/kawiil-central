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
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { useCelulas } from "@/hooks/useCatalogs";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OrgUser } from "@/hooks/useOrgUsers";
import { GRADO_SELECT_OPTIONS } from "@/lib/gradoLabels";
import type { AppGrado } from "@/lib/gradoLabels";
import { useEffect, useState } from "react";
import { useUserCelulas, useSyncUserCelulas } from "@/hooks/useUserCelulas";
import {
  MODULE_KEYS,
  MODULE_LABELS,
  useUserModulePermissions,
  useSyncModulePermissions,
} from "@/hooks/useModulePermissions";
import { useUserRole } from "@/hooks/useUserRole";
import {
  useFinanceIncomeViewerForUser,
  useSetFinanceIncomeViewer,
} from "@/hooks/useFinanceIncomeViewer";


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
      profileData: { full_name: string; phone?: string | null; area?: string | null };
      role: string;
    }) => {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: profileData.full_name,
          phone: profileData.phone || null,
          area: (profileData.area || null) as any,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["org-profiles"] });
      toast.success("Usuario actualizado");
    },
    onError: (e) => toast.error(e.message || "Error al actualizar usuario"),
  });
}

export function UserEditDialog({ user, open, onOpenChange }: UserEditDialogProps) {
  const { areaOptions } = useAreaOptions();
  const { data: celulas = [] } = useCelulas();
  const activeCelulas = celulas.filter((c) => c.is_active);
  const updateUser = useUpdateUser();
  const syncCelulas = useSyncUserCelulas();
  const { data: userCelulas = [] } = useUserCelulas(user?.user_id);
  const [selectedCelulaIds, setSelectedCelulaIds] = useState<string[]>([]);
  const { data: userModules = {} } = useUserModulePermissions(user?.user_id);
  const syncModules = useSyncModulePermissions();
  const [moduleState, setModuleState] = useState<Record<string, boolean>>({});
  const { isAdminOrManager } = useUserRole();
  const { data: hasSavioIncomeRow = false } = useFinanceIncomeViewerForUser(user?.user_id);
  const setSavioViewer = useSetFinanceIncomeViewer();
  const [savioIncomeEnabled, setSavioIncomeEnabled] = useState(false);

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
      form.reset({
        full_name: user.full_name,
        phone: user.phone || "",
        area: user.area || "",
        role: (user.role as AppGrado) || "ejecutor",
      });
      setSelectedCelulaIds(userCelulas.map((uc) => uc.celula_id));
      const ms: Record<string, boolean> = {};
      for (const k of MODULE_KEYS) ms[k] = !!userModules[k];
      setModuleState(ms);
      setSavioIncomeEnabled(hasSavioIncomeRow);
    }
  }, [user, open, form, userCelulas, userModules, hasSavioIncomeRow]);

  const toggleCelula = (celulaId: string) => {
    setSelectedCelulaIds((prev) =>
      prev.includes(celulaId)
        ? prev.filter((id) => id !== celulaId)
        : [...prev, celulaId]
    );
  };

  const onSubmit = async (values: EditFormValues) => {
    if (!user) return;

    // Determine primary area from selected células
    const primaryCelula = activeCelulas.find((c) => selectedCelulaIds.includes(c.id));
    const primaryArea = primaryCelula?.slug || values.area || null;

    await updateUser.mutateAsync({
      userId: user.user_id,
      profileData: {
        full_name: values.full_name,
        phone: values.phone || null,
        area: primaryArea,
      },
      role: values.role,
    });

    // Sync multi-célula assignments
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

      await syncModules.mutateAsync({
        userId: user.user_id,
        organizationId: profile.organization_id,
        modules: moduleState,
      });

      if (isAdminOrManager) {
        const savioEffective = !!moduleState.finanzas && savioIncomeEnabled;
        await setSavioViewer.mutateAsync({
          userId: user.user_id,
          organizationId: profile.organization_id,
          enabled: savioEffective,
        });
      }
    }

    onOpenChange(false);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
                  <Select onValueChange={field.onChange} value={field.value}>
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

            <div>
              <label className="text-sm font-medium">Módulos habilitados</label>
              <div className="space-y-2 border rounded-md p-2 mt-1.5">
                {MODULE_KEYS.map((key) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-sm">
                    <span>{MODULE_LABELS[key]}</span>
                    <Switch
                      checked={!!moduleState[key]}
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

            {isAdminOrManager && (
              <div className="rounded-md border border-border/80 bg-muted/30 p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Finanzas del usuario</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    El módulo &quot;Finanzas&quot; arriba controla el acceso al menú. Los atajos ajustan también
                    si ve solo gastos o también ingresos Savio (CXC).
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => {
                      setModuleState((prev) => ({ ...prev, finanzas: true }));
                      setSavioIncomeEnabled(false);
                    }}
                  >
                    Solo gastos
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => {
                      setModuleState((prev) => ({ ...prev, finanzas: true }));
                      setSavioIncomeEnabled(true);
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
                    onCheckedChange={setSavioIncomeEnabled}
                  />
                </label>
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
