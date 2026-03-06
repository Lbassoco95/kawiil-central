import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Folder } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateClient, useOrgProfiles } from "@/hooks/useClients";
import { DropboxFolderPicker } from "@/components/clients/DropboxFolderPicker";
import type { Database } from "@/integrations/supabase/types";
import type { Tables } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientType = Database["public"]["Enums"]["client_type"];
type Client = Tables<"clients">;

import { SERVICE_LABELS } from "@/lib/serviceLabels";

const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  persona_moral: "Persona Moral",
  persona_fisica: "Persona Física",
};

type ServicePackage = "softlanding" | "backoffice" | "individual";

const PACKAGE_LABELS: Record<ServicePackage, string> = {
  backoffice: "Backoffice",
  softlanding: "Soft Landing",
  individual: "Individual",
};

const PACKAGE_DESCRIPTIONS: Record<ServicePackage, string> = {
  backoffice: "Servicio contable, administrativo y legal",
  softlanding: "Backoffice + representación legal, domicilio fiscal y gestión de tesorería",
  individual: "Selección individual de servicios",
};

const PACKAGE_INCLUDED_SERVICES: Record<ServicePackage, ServiceArea[]> = {
  softlanding: ["contabilidad", "legal", "softlanding"],
  backoffice: ["contabilidad", "legal"],
  individual: [],
};

const EXTRA_SERVICES: { value: ServiceArea; label: string }[] = [
  { value: "pld_ft", label: "PLD/FT" },
  { value: "juicios", label: "Juicios" },
  { value: "gestoria", label: "Gestoría" },
  { value: "constitucion_nacional", label: "Constitución Nacional" },
];

const INDIVIDUAL_SERVICES: { value: ServiceArea; label: string }[] = [
  { value: "contabilidad", label: "Contabilidad" },
  { value: "legal", label: "Legal" },
  { value: "pld_ft", label: "PLD/FT" },
  { value: "juicios", label: "Juicios" },
  { value: "gestoria", label: "Gestoría" },
  { value: "constitucion_nacional", label: "Constitución Nacional" },
];

const ALL_SERVICE_AREAS = ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional"] as const;

const clientSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(200),
  client_type: z.enum(["persona_moral", "persona_fisica"] as const),
  rfc: z.string().trim().max(13).optional().or(z.literal("")),
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  service_package: z.enum(["softlanding", "backoffice", "individual"] as const),
  extra_services: z.array(z.enum(ALL_SERVICE_AREAS)).default([]),
  individual_services: z.array(z.enum(ALL_SERVICE_AREAS)).default([]),
  has_payroll: z.boolean().default(false),
  primary_area: z.enum(ALL_SERVICE_AREAS).optional().nullable(),
  responsible_user_id: z.string().uuid().optional().nullable().or(z.literal("")),
  status: z.enum(["activo", "inactivo", "prospecto"] as const),
  contact_name: z.string().trim().max(200).optional().or(z.literal("")),
  contact_position: z.string().trim().max(200).optional().or(z.literal("")),
  dropbox_folder_path: z.string().trim().max(500).optional().or(z.literal("")),
});

type ClientFormValues = z.infer<typeof clientSchema>;

function computeServices(values: ClientFormValues): ServiceArea[] {
  const pkg = values.service_package;
  const base = PACKAGE_INCLUDED_SERVICES[pkg] || [];
  const extras = pkg === "individual" ? values.individual_services : values.extra_services;
  const combined = new Set<ServiceArea>([...base, ...extras]);
  return Array.from(combined);
}

/** Detect which package a client's existing services belong to */
function detectPackage(services: ServiceArea[]): ServicePackage {
  if (services.includes("softlanding")) return "softlanding";
  if (services.includes("contabilidad") && services.includes("legal")) return "backoffice";
  return "individual";
}

function detectExtras(services: ServiceArea[], pkg: ServicePackage): ServiceArea[] {
  const included = PACKAGE_INCLUDED_SERVICES[pkg];
  return services.filter((s) => !included.includes(s));
}

interface ClientEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
}

export function ClientEditDialog({ open, onOpenChange, client }: ClientEditDialogProps) {
  const updateClient = useUpdateClient();
  const { data: profiles } = useOrgProfiles();
  const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);

  const detectedPkg = detectPackage(client.services || []);
  const detectedExtras = detectExtras(client.services || [], detectedPkg);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client.name,
      client_type: client.client_type,
      rfc: client.rfc || "",
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
      notes: client.notes || "",
      service_package: detectedPkg,
      extra_services: detectedPkg !== "individual" ? detectedExtras : [],
      individual_services: detectedPkg === "individual" ? (client.services || []) : [],
      has_payroll: (client as any).has_payroll || false,
      primary_area: client.primary_area || null,
      responsible_user_id: client.responsible_user_id || "",
      status: client.status,
      contact_name: client.contact_name || "",
      contact_position: client.contact_position || "",
      dropbox_folder_path: client.dropbox_folder_path || "",
    },
  });

  // Reset form when client changes
  useEffect(() => {
    if (open) {
      const pkg = detectPackage(client.services || []);
      const extras = detectExtras(client.services || [], pkg);
      form.reset({
        name: client.name,
        client_type: client.client_type,
        rfc: client.rfc || "",
        email: client.email || "",
        phone: client.phone || "",
        address: client.address || "",
        notes: client.notes || "",
        service_package: pkg,
        extra_services: pkg !== "individual" ? extras : [],
        individual_services: pkg === "individual" ? (client.services || []) : [],
        has_payroll: (client as any).has_payroll || false,
        primary_area: client.primary_area || null,
        responsible_user_id: client.responsible_user_id || "",
        status: client.status,
        contact_name: client.contact_name || "",
        contact_position: client.contact_position || "",
        dropbox_folder_path: client.dropbox_folder_path || "",
      });
    }
  }, [open, client, form]);

  const servicePackage = form.watch("service_package");
  const allServices = computeServices(form.getValues());
  const includedServices = PACKAGE_INCLUDED_SERVICES[servicePackage] || [];

  const onSubmit = async (values: ClientFormValues) => {
    const services = computeServices(values);
    if (services.length === 0) {
      form.setError("individual_services", { message: "Selecciona al menos un servicio" });
      return;
    }
    await updateClient.mutateAsync({
      id: client.id,
      previousServices: client.services || [],
      updates: {
        name: values.name,
        client_type: values.client_type,
        rfc: values.rfc || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        notes: values.notes || null,
        services,
        primary_area: values.primary_area || null,
        responsible_user_id: values.responsible_user_id || null,
        status: values.status,
        contact_name: values.contact_name || null,
        contact_position: values.contact_position || null,
        dropbox_folder_path: values.dropbox_folder_path || null,
        has_payroll: values.has_payroll,
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Cliente</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Nombre / Razón Social *</FormLabel>
                    <FormControl>
                      <Input placeholder="Nombre del cliente" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="client_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de cliente</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.entries(CLIENT_TYPE_LABELS) as [ClientType, string][]).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rfc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RFC</FormLabel>
                    <FormControl>
                      <Input placeholder="XAXX010101000" maxLength={13} {...field} />
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
                    <FormLabel>Email</FormLabel>
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
                name="address"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Dirección</FormLabel>
                    <FormControl>
                      <Input placeholder="Dirección fiscal" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estatus</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="activo">Activo</SelectItem>
                        <SelectItem value="prospecto">Prospecto</SelectItem>
                        <SelectItem value="inactivo">Inactivo</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="responsible_user_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsable</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar responsable" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {profiles?.map((p) => (
                          <SelectItem key={p.user_id} value={p.user_id}>
                            {p.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Service Package */}
            <FormField
              control={form.control}
              name="service_package"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Paquete de servicios *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.entries(PACKAGE_LABELS) as [ServicePackage, string][]).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground mt-1">
                    {PACKAGE_DESCRIPTIONS[field.value as ServicePackage]}
                  </p>
                  {servicePackage !== "individual" && includedServices.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Incluye: {includedServices.map((s) => SERVICE_LABELS[s]).join(", ")}
                    </p>
                  )}
                </FormItem>
              )}
            />

            {/* Extra services for packages */}
            {servicePackage !== "individual" && (
              <FormField
                control={form.control}
                name="extra_services"
                render={() => (
                  <FormItem>
                    <FormLabel>Servicios adicionales</FormLabel>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      {EXTRA_SERVICES.map((service) => (
                        <FormField
                          key={service.value}
                          control={form.control}
                          name="extra_services"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(service.value)}
                                  onCheckedChange={(checked) => {
                                    const updated = checked
                                      ? [...(field.value || []), service.value]
                                      : field.value?.filter((s) => s !== service.value) || [];
                                    field.onChange(updated);
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {service.label}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                  </FormItem>
                )}
              />
            )}

            {/* Individual services */}
            {servicePackage === "individual" && (
              <FormField
                control={form.control}
                name="individual_services"
                render={() => (
                  <FormItem>
                    <FormLabel>Servicios contratados *</FormLabel>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      {INDIVIDUAL_SERVICES.map((service) => (
                        <FormField
                          key={service.value}
                          control={form.control}
                          name="individual_services"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(service.value)}
                                  onCheckedChange={(checked) => {
                                    const updated = checked
                                      ? [...(field.value || []), service.value]
                                      : field.value?.filter((s) => s !== service.value) || [];
                                    field.onChange(updated);
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {service.label}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Payroll toggle */}
            {(servicePackage === "backoffice" || servicePackage === "softlanding" || allServices.includes("contabilidad")) && (
              <FormField
                control={form.control}
                name="has_payroll"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="cursor-pointer">Lleva nómina</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Agrega obligaciones de ISR Retenciones, IMSS e ISN al proyecto contable
                      </p>
                    </div>
                  </FormItem>
                )}
              />
            )}

            {/* Primary area */}
            {allServices.length > 1 && (
              <FormField
                control={form.control}
                name="primary_area"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Área principal</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar área principal" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allServices.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SERVICE_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Contact person */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Persona de contacto del cliente</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre del contacto</FormLabel>
                      <FormControl>
                        <Input placeholder="Nombre completo" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contact_position"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cargo</FormLabel>
                      <FormControl>
                        <Input placeholder="Director, Gerente, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Dropbox */}
            <FormField
              control={form.control}
              name="dropbox_folder_path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Carpeta en Dropbox</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        readOnly
                        placeholder="Sin carpeta enlazada"
                        value={field.value || ""}
                        className="flex-1 cursor-pointer bg-muted/30"
                        onClick={() => setDropboxPickerOpen(true)}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDropboxPickerOpen(true)}
                    >
                      <Folder className="h-4 w-4 mr-1" />
                      Explorar
                    </Button>
                    {field.value && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => field.onChange("")}
                      >
                        Quitar
                      </Button>
                    )}
                  </div>
                  <FormMessage />
                  <DropboxFolderPicker
                    open={dropboxPickerOpen}
                    onClose={() => setDropboxPickerOpen(false)}
                    onSelect={(path) => field.onChange(path)}
                  />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Observaciones adicionales..." rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateClient.isPending}>
                {updateClient.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
