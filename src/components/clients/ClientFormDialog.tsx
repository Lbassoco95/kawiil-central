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
import { Folder, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useCreateClient } from "@/hooks/useClients";
import { useOrgProfiles } from "@/hooks/useClients";
import { useSavioWriteAccess } from "@/hooks/useSavioWriteAccess";
import { useClientGroups, useCreateClientGroup, useAddClientToGroup } from "@/hooks/useClientGroups";
import { DropboxFolderPicker } from "@/components/clients/DropboxFolderPicker";
import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];
type ClientType = Database["public"]["Enums"]["client_type"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  persona_moral: "Persona Moral",
  persona_fisica: "Persona Física",
};

// Package definitions
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

// Extra services that can be added on top of a package
const EXTRA_SERVICES: { value: ServiceArea; label: string }[] = [
  { value: "pld_ft", label: "PLD/FT" },
  { value: "juicios", label: "Juicios" },
  { value: "gestoria", label: "Gestoría" },
  { value: "constitucion_nacional", label: "Constitución Nacional" },
  { value: "cumplimiento", label: "Cumplimiento" },
  { value: "representacion", label: "Representación" },
];

const INDIVIDUAL_SERVICES: { value: ServiceArea; label: string }[] = [
  { value: "contabilidad", label: "Contabilidad" },
  { value: "legal", label: "Legal" },
  { value: "pld_ft", label: "PLD/FT" },
  { value: "juicios", label: "Juicios" },
  { value: "gestoria", label: "Gestoría" },
  { value: "constitucion_nacional", label: "Constitución Nacional" },
  { value: "cumplimiento", label: "Cumplimiento" },
  { value: "representacion", label: "Representación" },
];

const ALL_SERVICE_AREAS = [
  "contabilidad",
  "legal",
  "softlanding",
  "pld_ft",
  "juicios",
  "gestoria",
  "constitucion_nacional",
  "cumplimiento",
  "representacion",
] as const;

const clientSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(200),
  client_type: z.enum(["persona_moral", "persona_fisica"] as const),
  rfc: z.string().trim().max(13).optional().or(z.literal("")),
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  service_package: z.enum(["softlanding", "backoffice", "individual"] as const),
  extra_services: z.array(z.string()).default([]) as any,
  individual_services: z.array(z.string()).default([]) as any,
  payroll_type: z.enum(["none", "nomina", "asimilados", "ambos"] as const).default("none"),
  primary_area: z.string().optional().nullable() as any,
  responsible_user_id: z.string().uuid().optional().nullable().or(z.literal("")),
  status: z.enum(["activo", "inactivo", "prospecto"] as const),
  contact_name: z.string().trim().max(200).optional().or(z.literal("")),
  contact_position: z.string().trim().max(200).optional().or(z.literal("")),
  dropbox_folder_path: z.string().trim().max(500).optional().or(z.literal("")),
  collaborator_user_ids: z.array(z.string().uuid()).default([]),
});

type ClientFormValues = z.infer<typeof clientSchema>;

export type ClientFormSavioPrefill = {
  savio_customer_id?: string;
  name?: string;
  rfc?: string;
  email?: string;
  phone?: string;
};

interface ClientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Precarga desde panel «Savio sin Kawiil»; se limpia al cerrar desde el padre. */
  savioPrefill?: ClientFormSavioPrefill | null;
}

function computeServices(values: ClientFormValues): ServiceArea[] {
  const pkg = values.service_package;
  const base = PACKAGE_INCLUDED_SERVICES[pkg] || [];
  const extras = pkg === "individual" ? values.individual_services : values.extra_services;
  const combined = new Set<ServiceArea>([...base, ...extras]);
  return Array.from(combined);
}

export function ClientFormDialog({ open, onOpenChange, savioPrefill = null }: ClientFormDialogProps) {
  const createClient = useCreateClient();
  const { data: profiles } = useOrgProfiles();
  const { data: clientGroups } = useClientGroups();
  const createGroup = useCreateClientGroup();
  const addToGroup = useAddClientToGroup();
  const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [newGroupName, setNewGroupName] = useState("");
  const [createInSavio, setCreateInSavio] = useState(false);
  const { data: savioWriteAccess } = useSavioWriteAccess();
  const canSavioWrite = savioWriteAccess?.canWrite === true;

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: "",
      client_type: "persona_moral",
      rfc: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
      service_package: "backoffice",
      extra_services: [],
      individual_services: [],
      payroll_type: "none",
      primary_area: null,
      responsible_user_id: "",
      status: "activo",
      contact_name: "",
      contact_position: "",
      dropbox_folder_path: "",
      collaborator_user_ids: [],
    },
  });

  const responsibleId = form.watch("responsible_user_id");
  const collaboratorIds = form.watch("collaborator_user_ids");
  useEffect(() => {
    if (!responsibleId || !collaboratorIds?.length) return;
    if (collaboratorIds.includes(responsibleId)) {
      form.setValue(
        "collaborator_user_ids",
        collaboratorIds.filter((uid) => uid !== responsibleId)
      );
    }
  }, [responsibleId, form, collaboratorIds]);

  const servicePackage = form.watch("service_package");
  const extraServices = form.watch("extra_services");
  const individualServices = form.watch("individual_services");

  const allServices = computeServices(form.getValues());

  // Reset extras when package changes
  useEffect(() => {
    form.setValue("extra_services", []);
    form.setValue("individual_services", []);
    form.setValue("primary_area", null);
  }, [servicePackage, form]);

  useEffect(() => {
    if (!open || !savioPrefill) return;
    if (savioPrefill.name) form.setValue("name", savioPrefill.name);
    if (savioPrefill.rfc) form.setValue("rfc", savioPrefill.rfc);
    if (savioPrefill.email) form.setValue("email", savioPrefill.email);
    if (savioPrefill.phone) form.setValue("phone", savioPrefill.phone);
    setCreateInSavio(false);
  }, [open, savioPrefill, form]);

  const onSubmit = async (values: ClientFormValues) => {
    const services = computeServices(values);
    if (services.length === 0) {
      form.setError("individual_services", { message: "Selecciona al menos un servicio" });
      return;
    }
    const sid = savioPrefill?.savio_customer_id?.trim();
    const newClient = await createClient.mutateAsync({
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
      payroll_type: values.payroll_type === "none" ? null : values.payroll_type,
      collaborator_user_ids: values.collaborator_user_ids,
      savio_customer_id: sid || undefined,
      savio_customer_linked_at: sid ? new Date().toISOString() : undefined,
      create_in_savio: createInSavio && !sid,
    });

    if (newClient) {
      let groupId = selectedGroupId;
      if (!groupId && newGroupName.trim()) {
        const g = await createGroup.mutateAsync({ name: newGroupName.trim() });
        groupId = g.id;
      }
      if (groupId) {
        await addToGroup.mutateAsync({ groupId, clientId: newClient.id });
      }
    }

    form.reset();
    setSelectedGroupId("");
    setNewGroupName("");
    setCreateInSavio(false);
    onOpenChange(false);
  };

  const includedServices = PACKAGE_INCLUDED_SERVICES[servicePackage] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Cliente</DialogTitle>
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                    <SearchableSelect
                      options={(profiles || []).map((p) => ({ value: p.user_id, label: p.full_name }))}
                      value={field.value || ""}
                      onValueChange={field.onChange}
                      placeholder="Seleccionar responsable"
                      searchPlaceholder="Buscar usuario..."
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="collaborator_user_ids"
                render={({ field }) => {
                  const opts = (profiles || [])
                    .filter(
                      (p) =>
                        p.user_id !== (form.getValues("responsible_user_id") || "") &&
                        !field.value.includes(p.user_id)
                    )
                    .map((p) => ({ value: p.user_id, label: p.full_name }))
                    .sort((a, b) => a.label.localeCompare(b.label, "es"));
                  return (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Colaboradores de seguimiento</FormLabel>
                      <p className="text-xs text-muted-foreground mb-2">
                        Personas al pendiente del cliente además del responsable. Podrás cambiarlos cuando quieras desde
                        Editar cliente.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {field.value.map((uid) => {
                          const p = profiles?.find((pr) => pr.user_id === uid);
                          return (
                            <Badge key={uid} variant="secondary" className="text-xs gap-1">
                              {p?.full_name || uid}
                              <X
                                role="button"
                                className="h-3 w-3 cursor-pointer shrink-0"
                                onClick={() => field.onChange(field.value.filter((x) => x !== uid))}
                              />
                            </Badge>
                          );
                        })}
                      </div>
                      <SearchableSelect
                        options={opts}
                        value=""
                        onValueChange={(v) => {
                          if (v && !field.value.includes(v)) field.onChange([...field.value, v]);
                        }}
                        placeholder="Agregar colaborador..."
                        searchPlaceholder="Buscar usuario..."
                      />
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>

            {/* Client Group */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Grupo empresarial (opcional)</label>
              <Select value={selectedGroupId || "none"} onValueChange={(v) => { setSelectedGroupId(v === "none" ? "" : v); if (v !== "none") setNewGroupName(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin grupo</SelectItem>
                  {(clientGroups || []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selectedGroupId && (
                <Input
                  placeholder="O escribe un nuevo grupo..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="text-sm"
                />
              )}
              <p className="text-xs text-muted-foreground">
                Agrupa clientes relacionados (ej. empresas del mismo corporativo).
              </p>
            </div>

            {/* Service Package */}
            <FormField
              control={form.control}
              name="service_package"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Paquete de servicios *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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

            {/* Individual services selection */}
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

            {/* Payroll type selector */}
            {(servicePackage === "backoffice" || servicePackage === "softlanding" || allServices.includes("contabilidad")) && (
              <FormField
                control={form.control}
                name="payroll_type"
                render={({ field }) => (
                  <FormItem className="rounded-md border p-4">
                    <FormLabel>Tipo de nómina</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Sin nómina</SelectItem>
                        <SelectItem value="nomina">Nómina</SelectItem>
                        <SelectItem value="asimilados">Asimilados a salarios</SelectItem>
                        <SelectItem value="ambos">Nómina + Asimilados</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {field.value === "nomina" && "Agrega ISR Retenciones (nómina), IMSS e ISN"}
                      {field.value === "asimilados" && "Agrega únicamente ISR Retenciones (asimilados)"}
                      {field.value === "ambos" && "Agrega ISR Retenciones (nómina), ISR Retenciones (asimilados), IMSS e ISN"}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Primary area - show when multiple services */}
            {allServices.length > 1 && (
              <FormField
                control={form.control}
                name="primary_area"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Área principal</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
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

            {/* Dropbox folder path */}
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
                  <p className="text-xs text-muted-foreground">
                    Selecciona la carpeta del cliente en Dropbox para vincular sus documentos.
                  </p>
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
                    <Textarea
                      placeholder="Observaciones adicionales..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {savioPrefill?.savio_customer_id ? (
              <p className="text-[11px] text-muted-foreground rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                Se guardará el vínculo con Savio (<span className="font-mono">{savioPrefill.savio_customer_id}</span>)
                al crear el cliente en Kawiil.
              </p>
            ) : canSavioWrite ? (
              <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/10 p-3">
                <Checkbox
                  id="cf-create-savio"
                  checked={createInSavio}
                  onCheckedChange={(c) => setCreateInSavio(c === true)}
                  disabled={createClient.isPending}
                />
                <label htmlFor="cf-create-savio" className="text-xs leading-relaxed cursor-pointer">
                  <span className="font-medium text-foreground">Crear también en Savio</span>
                  <span className="block text-muted-foreground mt-0.5">
                    Requiere permiso de escritura Finanzas. Si Savio falla, el cliente queda en Kawiil y podrás enlazar
                    después.
                  </span>
                </label>
              </div>
            ) : null}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createClient.isPending}>
                {createClient.isPending ? "Guardando..." : "Crear cliente"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
