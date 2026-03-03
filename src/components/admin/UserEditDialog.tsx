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
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OrgUser } from "@/hooks/useOrgUsers";
import type { Database } from "@/integrations/supabase/types";
import { useEffect } from "react";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  manager: "Gerente",
  staff: "Staff",
  viewer: "Viewer (solo lectura)",
};

const editSchema = z.object({
  full_name: z.string().trim().min(1, "El nombre es requerido").max(200),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  area: z.string().optional().or(z.literal("")),
  role: z.enum(["admin", "manager", "staff", "viewer"] as const),
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
      // Update profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: profileData.full_name,
          phone: profileData.phone || null,
          area: (profileData.area || null) as any,
        })
        .eq("user_id", userId);
      if (profileError) throw profileError;

      // Update role — upsert
      const { error: roleError } = await supabase
        .from("user_roles")
        .upsert(
          { user_id: userId, role: role as AppRole },
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
  const updateUser = useUpdateUser();

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      full_name: "",
      phone: "",
      area: "",
      role: "staff",
    },
  });

  useEffect(() => {
    if (user && open) {
      form.reset({
        full_name: user.full_name,
        phone: user.phone || "",
        area: user.area || "",
        role: (user.role as AppRole) || "staff",
      });
    }
  }, [user, open, form]);

  const onSubmit = async (values: EditFormValues) => {
    if (!user) return;
    await updateUser.mutateAsync({
      userId: user.user_id,
      profileData: {
        full_name: values.full_name,
        phone: values.phone || null,
        area: values.area || null,
      },
      role: values.role,
    });
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
                  <FormLabel>Rol *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.entries(ROLE_LABELS) as [AppRole, string][]).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
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
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Área</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                    value={field.value || "__none__"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asignar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sin asignar</SelectItem>
                      {areaOptions.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

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
