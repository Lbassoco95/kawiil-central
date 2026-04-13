import { useEffect, useMemo, useState } from "react";
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
import { useUpdateClient, useOrgProfiles } from "@/hooks/useClients";
import { useClientCollaboratorIds } from "@/hooks/useClientCollaborators";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { useSavioFinanceApiData } from "@/hooks/useSavioFinanceApi";
import { SavioSearchablePick } from "@/components/finanzas/SavioSearchablePick";
import { DropboxFolderPicker } from "@/components/clients/DropboxFolderPicker";
import { findSavioCustomerIdsByRfc, normalizeRfcForCompare } from "@/lib/clientSavioLink";
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
  { value: "cumplimiento", label: "Cumplimiento" },
  { value: "representacion" as ServiceArea, label: "Representación" },
];

const INDIVIDUAL_SERVICES: { value: ServiceArea; label: string }[] = [
  { value: "contabilidad", label: "Contabilidad" },
  { value: "legal", label: "Legal" },
  { value: "pld_ft", label: "PLD/FT" },
  { value: "juicios", label: "Juicios" },
  { value: "gestoria", label: "Gestoría" },
  { value: "constitucion_nacional", label: "Constitución Nacional" },
  { value: "cumplimiento", label: "Cumplimiento" },
  { value: "representacion" as ServiceArea, label: "Representación" },
];

const ALL_SERVICE_AREAS = ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento", "representacion"] as const;

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
  sat_fiel_managed_by_firm: z.boolean(),
  sat_fiel_location_hint: z.string().trim().max(500).optional().or(z.literal("")),
  savio_customer_id: z.string().trim().max(128).optional().or(z.literal("")),
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
  const { hasFinanceAccess, isLoading: financeAccessLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioIncomeLoading } = useSavioIncomeAccess();
  const showSavioBlock =
    hasFinanceAccess && canViewSavioIncome && !financeAccessLoading && !savioIncomeLoading;
  const { customerRows, customerPickOptions } = useSavioFinanceApiData({
    fetchEnabled: open && showSavioBlock,
  });
  const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);
  const { data: loadedCollaboratorIds = [], isFetched: collabFetched } = useClientCollaboratorIds(
    client.id,
    open
  );
  const collabKey = useMemo(
    () => [...loadedCollaboratorIds].sort().join(","),
    [loadedCollaboratorIds]
  );

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
      payroll_type: (client as any).payroll_type || "none",
      primary_area: client.primary_area || null,
      responsible_user_id: client.responsible_user_id || "",
      status: client.status,
      contact_name: client.contact_name || "",
      contact_position: client.contact_position || "",
      dropbox_folder_path: client.dropbox_folder_path || "",
      collaborator_user_ids: [],
      sat_fiel_managed_by_firm: client.sat_fiel_managed_by_firm !== false,
      sat_fiel_location_hint: client.sat_fiel_location_hint || "",
      savio_customer_id: client.savio_customer_id || "",
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

  // Reset form when client opens or collaborator list is loaded from server
  useEffect(() => {
    if (!open || !collabFetched) return;
    const pkg = detectPackage(client.services || []);
    const extras = detectExtras(client.services || [], pkg);
    const collaboratorIdsFromServer = collabKey ? collabKey.split(",").filter((x) => x.length > 0) : [];
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
      payroll_type: (client as any).payroll_type || "none",
      primary_area: client.primary_area || null,
      responsible_user_id: client.responsible_user_id || "",
      status: client.status,
      contact_name: client.contact_name || "",
      contact_position: client.contact_position || "",
      dropbox_folder_path: client.dropbox_folder_path || "",
      collaborator_user_ids: collaboratorIdsFromServer,
      sat_fiel_managed_by_firm: client.sat_fiel_managed_by_firm !== false,
      sat_fiel_location_hint: client.sat_fiel_location_hint || "",
      savio_customer_id: client.savio_customer_id || "",
    });
  }, [open, collabFetched, client, collabKey, form]);

  const servicePackage = form.watch("service_package");
  const rfcWatch = form.watch("rfc");
  const suggestedSavioByRfc = useMemo(
    () => findSavioCustomerIdsByRfc(normalizeRfcForCompare(rfcWatch), customerRows),
    [rfcWatch, customerRows],
  );
  const allServices = computeServices(form.getValues());
  const includedServices = PACKAGE_INCLUDED_SERVICES[servicePackage] || [];

  const onSubmit = async (values: ClientFormValues) => {
    const services = computeServices(values);
    if (services.length === 0) {
      form.setError("individual_services", { message: "Selecciona al menos un servicio" });
      return;
    }
    const newSid = values.savio_customer_id?.trim() || null;
    const prevSid = client.savio_customer_id?.trim() || null;
    let savio_linked_at: string | null = client.savio_customer_linked_at ?? null;
    if (!newSid) savio_linked_at = null;
    else if (newSid !== prevSid) savio_linked_at = new Date().toISOString();

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
        payroll_type: values.payroll_type === "none" ? null : values.payroll_type,
        sat_fiel_managed_by_firm: values.sat_fiel_managed_by_firm,
        sat_fiel_location_hint: values.sat_fiel_location_hint || null,
        savio_customer_id: newSid,
        savio_customer_linked_at: savio_linked_at,
      },
      collaborator_user_ids: values.collaborator_user_ids,
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

              {showSavioBlock ? (
                <div className="md:col-span-2 rounded-md border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <p className="text-xs font-medium text-foreground">Vínculo Savio (cobranza)</p>
                  <p className="text-[11px] text-muted-foreground">
                    El id debe coincidir con un cliente en Savio. Lista hasta 100 registros de la API.
                  </p>
                  {suggestedSavioByRfc.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-amber-800 dark:text-amber-200">
                        Coincidencia por RFC en Savio ({suggestedSavioByRfc.length})
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => form.setValue("savio_customer_id", suggestedSavioByRfc[0])}
                      >
                        Usar primer id sugerido
                      </Button>
                    </div>
                  ) : null}
                  <FormField
                    control={form.control}
                    name="savio_customer_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Id cliente Savio</FormLabel>
                        {customerPickOptions.length > 0 ? (
                          <SavioSearchablePick
                            options={customerPickOptions}
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Buscar en lista Savio…"
                            searchPlaceholder="Cliente Savio…"
                            disabled={updateClient.isPending}
                          />
                        ) : null}
                        <FormControl>
                          <Input
                            className="font-mono text-xs mt-1"
                            placeholder="UUID o id (editable)"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}

              <div className="md:col-span-2 rounded-md border border-border/60 p-4 space-y-4 bg-muted/10">
                <p className="text-sm font-medium text-foreground">SAT — 69-B y RFC (Moffin)</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Las consultas Moffin (69-B y RFC) se lanzan desde el proyecto de Contabilidad. Aquí solo registramos si la
                  e.firma la tiene el despacho y una referencia interna (carpeta). No guardes contraseñas ni contenido de
                  llaves.
                </p>
                <FormField
                  control={form.control}
                  name="sat_fiel_managed_by_firm"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="font-normal cursor-pointer">La e.firma la custodia el despacho</FormLabel>
                        <p className="text-[11px] text-muted-foreground font-normal">
                          Coincide con el flujo en que ustedes tienen los certificados y solo faltaría contraseña puntual para
                          descargas.
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sat_fiel_location_hint"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referencia interna (opcional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Ej. Dropbox del cliente → FISCAL/EFIRMA/…"
                          className="min-h-[72px] resize-y text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                        Equipo al pendiente del cliente además del responsable.
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

            {/* Payroll type selector */}
            {(servicePackage === "backoffice" || servicePackage === "softlanding" || allServices.includes("contabilidad")) && (
              <FormField
                control={form.control}
                name="payroll_type"
                render={({ field }) => (
                  <FormItem className="rounded-md border p-4">
                    <FormLabel>Tipo de nómina</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
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
