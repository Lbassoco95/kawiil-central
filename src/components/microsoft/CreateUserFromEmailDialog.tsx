import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { useCreateUser } from "@/hooks/useOrgUsers";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { UserPlus, Mail } from "lucide-react";
import { GRADO_SELECT_OPTIONS } from "@/lib/gradoLabels";

const schema = z.object({
  email: z.string().trim().email("Email inválido"),
  full_name: z.string().trim().min(1, "El nombre es requerido").max(200),
  role: z.enum(["en_formacion", "ejecutor", "referente", "transformador"] as const),
  area: z.string().optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  password: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

interface CreateUserFromEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senderName?: string;
  senderEmail?: string;
  microsoftUserId?: string;
}

export function CreateUserFromEmailDialog({
  open,
  onOpenChange,
  senderName,
  senderEmail,
  microsoftUserId,
}: CreateUserFromEmailDialogProps) {
  const createUser = useCreateUser();
  const { areaOptions } = useAreaOptions();
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: senderEmail || "",
      full_name: senderName || "",
      role: "ejecutor",
      area: "",
      phone: "",
      password: "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        email: senderEmail || "",
        full_name: senderName || "",
        role: "ejecutor",
        area: "",
        phone: "",
        password: "",
      });
      setCreatedCredentials(null);
    }
  }, [open, senderEmail, senderName]);

  const onSubmit = async (values: FormValues) => {
    const result = await createUser.mutateAsync({
      email: values.email,
      full_name: values.full_name,
      password: values.password || "",
      role: values.role,
      area: values.area || undefined,
      phone: values.phone || undefined,
      microsoft_email: senderEmail || undefined,
      microsoft_user_id: microsoftUserId || undefined,
    });
    if (result?.temp_password) {
      setCreatedCredentials({
        email: values.email,
        password: result.temp_password,
      });
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Dar de alta Kawiiler desde correo
          </DialogTitle>
        </DialogHeader>

        {senderEmail && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{senderName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {senderEmail}
              </p>
            </div>
            {microsoftUserId && (
              <Badge variant="secondary" className="ml-auto text-xs shrink-0">
                Microsoft vinculado
              </Badge>
            )}
          </div>
        )}

        {createdCredentials ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
              <p className="font-medium text-sm">✅ Kawiiler creado exitosamente</p>
              <p className="text-sm text-muted-foreground">
                Comparte estas credenciales con el Kawiiler. Al iniciar sesión
                por primera vez, se le pedirá cambiar su contraseña.
              </p>
              <div className="space-y-2 font-mono text-sm bg-background rounded p-3 border">
                <p>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  {createdCredentials.email}
                </p>
                <p>
                  <span className="text-muted-foreground">Contraseña:</span>{" "}
                  {createdCredentials.password}
                </p>
              </div>
              {microsoftUserId && (
                <p className="text-xs text-muted-foreground">
                  🔗 Su cuenta de Microsoft quedó vinculada automáticamente.
                  Cuando inicie sesión, podrá conectar Outlook sin pasos
                  adicionales.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setCreatedCredentials(null);
                  form.reset();
                  onOpenChange(false);
                }}
              >
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
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
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="correo@empresa.com"
                          {...field}
                        />
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
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {GRADO_SELECT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
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
                      <FormLabel>Célula</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar célula" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {areaOptions.map((a) => (
                            <SelectItem key={a.value} value={a.value}>
                              {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contraseña temporal (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Se genera automáticamente si se deja vacío"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <p className="text-xs text-muted-foreground">
                Se creará el Kawiiler con su cuenta de Microsoft vinculada. Al
                iniciar sesión podrá conectar Outlook automáticamente.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending ? "Creando..." : "Crear Kawiiler"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
