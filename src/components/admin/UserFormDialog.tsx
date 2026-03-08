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
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { GRADO_SELECT_OPTIONS } from "@/lib/gradoLabels";

const inviteSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  full_name: z.string().trim().min(1, "El nombre es requerido").max(200),
  role: z.enum(["en_formacion", "ejecutor", "referente", "transformador"] as const),
  area: z.string().optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});

const createSchema = inviteSchema.extend({
  password: z.string().optional().or(z.literal("")),
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
  const { areaOptions } = useAreaOptions();

  const inviteForm = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      full_name: "",
      role: "ejecutor",
      area: "",
      phone: "",
    },
  });

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      email: "",
      full_name: "",
      role: "ejecutor",
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

  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);

  const onCreateSubmit = async (values: CreateFormValues) => {
    const result = await createUser.mutateAsync({
      email: values.email,
      full_name: values.full_name,
      password: values.password || "",
      role: values.role,
      area: values.area || undefined,
      phone: values.phone || undefined,
    });
    if (result?.temp_password) {
      setCreatedCredentials({ email: values.email, password: result.temp_password });
    } else {
      createForm.reset();
      onOpenChange(false);
    }
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
              <FormLabel>Grado *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Célula</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar célula" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {areaOptions.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
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
          <DialogTitle>Agregar Kawiiler</DialogTitle>
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
                  Se enviará un email de invitación para que el Kawiiler configure su contraseña.
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
            {createdCredentials ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <p className="font-medium text-sm">✅ Kawiiler creado exitosamente</p>
                  <p className="text-sm text-muted-foreground">
                    Comparte estas credenciales con el Kawiiler. Al iniciar sesión por primera vez, se le pedirá cambiar su contraseña.
                  </p>
                  <div className="space-y-2 font-mono text-sm bg-background rounded p-3 border">
                    <p><span className="text-muted-foreground">Email:</span> {createdCredentials.email}</p>
                    <p><span className="text-muted-foreground">Contraseña:</span> {createdCredentials.password}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => { setCreatedCredentials(null); createForm.reset(); onOpenChange(false); }}>
                    Cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                  {renderFields(createForm)}
                  <FormField
                    control={createForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña temporal (opcional)</FormLabel>
                        <FormControl>
                          <Input type="text" placeholder="Se genera automáticamente si se deja vacío" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    Se generará una contraseña provisional. El Kawiiler deberá cambiarla en su primer inicio de sesión.
                  </p>
                  <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Creando..." : "Crear Kawiiler"}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
