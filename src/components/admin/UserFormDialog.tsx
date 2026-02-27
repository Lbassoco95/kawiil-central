import { useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInviteUser, useCreateUser } from "@/hooks/useOrgUsers";
import { Mail, UserPlus } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  manager: "Gerente",
  staff: "Staff",
  viewer: "Viewer (solo lectura)",
};

const AREA_LABELS: Record<ServiceArea, string> = {
  contabilidad: "Contabilidad",
  legal: "Legal",
  softlanding: "Soft Landing",
  pld_ft: "PLD/FT",
  juicios: "Juicios",
};

const inviteSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  full_name: z.string().trim().min(1, "El nombre es requerido").max(200),
  role: z.enum(["admin", "manager", "staff", "viewer"] as const),
  area: z.string().optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});

const createSchema = inviteSchema.extend({
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

type InviteFormValues = z.infer<typeof inviteSchema>;
type CreateFormValues = z.infer<typeof createSchema>;

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserFormDialog({ open, onOpenChange }: UserFormDialogProps) {
  const [method, setMethod] = useState<"invite" | "create">("invite");
  const inviteUser = useInviteUser();
  const createUser = useCreateUser();

  const inviteForm = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      full_name: "",
      role: "staff",
      area: "",
      phone: "",
    },
  });

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      email: "",
      full_name: "",
      role: "staff",
      area: "",
      phone: "",
      password: "",
    },
  });

  const onInviteSubmit = async (values: InviteFormValues) => {
    await inviteUser.mutateAsync({
      email: values.email,
      full_name: values.full_name,
      role: values.role,
      area: values.area || undefined,
      phone: values.phone || undefined,
    });
    inviteForm.reset();
    onOpenChange(false);
  };

  const onCreateSubmit = async (values: CreateFormValues) => {
    await createUser.mutateAsync({
      email: values.email,
      full_name: values.full_name,
      password: values.password,
      role: values.role,
      area: values.area || undefined,
      phone: values.phone || undefined,
    });
    createForm.reset();
    onOpenChange(false);
  };

  const isPending = inviteUser.isPending || createUser.isPending;

  const renderFields = (form: any) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="full_name"
          render={({ field }: any) => (
            <FormItem className="md:col-span-2">
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
          name="email"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Email *</FormLabel>
              <FormControl>
                <Input type="email" placeholder="correo@empresa.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }: any) => (
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
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Rol *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Área</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar área" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(Object.entries(AREA_LABELS) as [ServiceArea, string][]).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar usuario</DialogTitle>
        </DialogHeader>

        <Tabs value={method} onValueChange={(v) => setMethod(v as "invite" | "create")}>
          <TabsList className="w-full">
            <TabsTrigger value="invite" className="flex-1 gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Invitar por email
            </TabsTrigger>
            <TabsTrigger value="create" className="flex-1 gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              Crear con contraseña
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invite" className="mt-4">
            <Form {...inviteForm}>
              <form onSubmit={inviteForm.handleSubmit(onInviteSubmit)} className="space-y-4">
                {renderFields(inviteForm)}
                <p className="text-xs text-muted-foreground">
                  Se enviará un email de invitación para que el usuario configure su contraseña.
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Enviando..." : "Enviar invitación"}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="create" className="mt-4">
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                {renderFields(createForm)}
                <FormField
                  control={createForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contraseña temporal *</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Mínimo 6 caracteres" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  El usuario podrá iniciar sesión inmediatamente con estas credenciales.
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Creando..." : "Crear usuario"}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
