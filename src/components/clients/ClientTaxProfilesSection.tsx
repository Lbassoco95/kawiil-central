import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  BadgeCheck,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Power,
  Receipt,
  ShieldQuestion,
  Star,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateMX } from "@/lib/dateUtils";
import {
  C_REGIMEN_FISCAL,
  C_USO_CFDI,
  etiquetaCatalogo,
  getRegimenFiscal,
  getUsoCfdi,
} from "@/lib/juun/satCatalogs";
import {
  AVISO_CSF,
  TAX_PROFILE_DEFAULTS,
  avisoPersonaVsRegimen,
  taxProfileSchema,
  type TaxProfileSchemaValues,
} from "@/lib/juun/taxProfileSchema";
import {
  getCsfSignedUrl,
  useClientTaxProfiles,
  useCreateTaxProfile,
  useDeactivateTaxProfile,
  useMarkCsfVerified,
  useReactivateTaxProfile,
  useSetDefaultTaxProfile,
  useUpdateTaxProfile,
  type TaxProfile,
} from "@/hooks/useClientTaxProfiles";

const CSF_MAX_BYTES = 10 * 1024 * 1024;

interface ClientTaxProfilesSectionProps {
  clientId: string;
  /** RFC de la ficha del cliente; solo para avisar si no coincide con el del perfil. */
  clientRfc?: string | null;
}

function ProfileRow({
  profile,
  clientRfc,
  onEdit,
  onSetDefault,
  onToggleActive,
  onToggleVerified,
  busy,
}: {
  profile: TaxProfile;
  clientRfc?: string | null;
  onEdit: () => void;
  onSetDefault: () => void;
  onToggleActive: () => void;
  onToggleVerified: () => void;
  busy: boolean;
}) {
  const [abriendoCsf, setAbriendoCsf] = useState(false);
  const regimen = getRegimenFiscal(profile.regimen_fiscal);
  const uso = getUsoCfdi(profile.uso_cfdi_default);
  const verificada = !!profile.csf_verified_at;
  const rfcFichaDistinto =
    !!clientRfc?.trim() && clientRfc.trim().toUpperCase() !== profile.rfc;

  const abrirCsf = async () => {
    if (!profile.csf_file_path) return;
    setAbriendoCsf(true);
    try {
      const url = await getCsfSignedUrl(profile.csf_file_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("No se pudo abrir la constancia.");
    } finally {
      setAbriendoCsf(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border border-border/60 bg-background/40 p-3 space-y-2",
        !profile.active && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-foreground">{profile.razon_social}</span>
            {profile.is_default && (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 font-normal bg-primary/10 text-primary border-primary/30"
              >
                <Star className="h-3 w-3" />
                Predeterminado
              </Badge>
            )}
            {verificada ? (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 font-normal bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
              >
                <BadgeCheck className="h-3 w-3" />
                CSF verificada {formatDateMX(profile.csf_verified_at)}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 font-normal bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
              >
                <ShieldQuestion className="h-3 w-3" />
                Sin verificar contra la CSF
              </Badge>
            )}
            {!profile.active && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                Dado de baja
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>
              RFC: <code className="text-[11px] text-foreground/80">{profile.rfc}</code>
            </span>
            <span>CP fiscal: {profile.cp_fiscal}</span>
            <span title={regimen?.descripcion}>
              Régimen: {profile.regimen_fiscal}
              {regimen ? ` — ${regimen.descripcion}` : ""}
            </span>
            <span title={uso?.descripcion}>Uso CFDI: {profile.uso_cfdi_default}</span>
            {profile.email_recepcion && <span>Recepción: {profile.email_recepcion}</span>}
          </div>

          {rfcFichaDistinto && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              El RFC de la ficha del cliente ({clientRfc?.trim().toUpperCase()}) no es este. Puede ser
              correcto si el cliente factura con varias empresas; si no, uno de los dos está mal.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {profile.csf_file_path && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1"
              onClick={abrirCsf}
              disabled={abriendoCsf}
            >
              {abriendoCsf ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              Ver CSF
            </Button>
          )}
          {profile.active && !profile.is_default && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] gap-1"
              onClick={onSetDefault}
              disabled={busy}
            >
              <Star className="h-3 w-3" />
              Hacer predeterminado
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] gap-1"
            onClick={onToggleVerified}
            disabled={busy}
          >
            <BadgeCheck className="h-3 w-3" />
            {verificada ? "Quitar verificación" : "Marcar como verificada"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1"
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3" />
            Editar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("h-7 text-[10px] gap-1", profile.active && "text-destructive")}
            onClick={onToggleActive}
            disabled={busy}
          >
            <Power className="h-3 w-3" />
            {profile.active ? "Dar de baja" : "Reactivar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ClientTaxProfilesSection({ clientId, clientRfc }: ClientTaxProfilesSectionProps) {
  const { data: profiles = [], isLoading, isError, refetch } = useClientTaxProfiles(clientId);
  const createMutation = useCreateTaxProfile(clientId);
  const updateMutation = useUpdateTaxProfile(clientId);
  const deactivateMutation = useDeactivateTaxProfile(clientId);
  const reactivateMutation = useReactivateTaxProfile(clientId);
  const setDefaultMutation = useSetDefaultTaxProfile(clientId);
  const verifyMutation = useMarkCsfVerified(clientId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxProfile | null>(null);
  const [csfFile, setCsfFile] = useState<File | null>(null);

  const form = useForm<TaxProfileSchemaValues>({
    resolver: zodResolver(taxProfileSchema),
    defaultValues: TAX_PROFILE_DEFAULTS,
  });

  const rfcActual = form.watch("rfc");
  const regimenActual = form.watch("regimen_fiscal");
  const aviso = useMemo(
    () => avisoPersonaVsRegimen(rfcActual ?? "", regimenActual ?? ""),
    [rfcActual, regimenActual]
  );

  useEffect(() => {
    if (!dialogOpen) return;
    form.reset(
      editing
        ? {
            rfc: editing.rfc,
            razon_social: editing.razon_social,
            cp_fiscal: editing.cp_fiscal,
            regimen_fiscal: editing.regimen_fiscal,
            uso_cfdi_default: editing.uso_cfdi_default,
            email_recepcion: editing.email_recepcion ?? "",
          }
        : TAX_PROFILE_DEFAULTS
    );
    setCsfFile(null);
    // `form` es estable entre renders (useForm); no entra en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editing]);

  const abrirAlta = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const abrirEdicion = (profile: TaxProfile) => {
    setEditing(profile);
    setDialogOpen(true);
  };

  const elegirCsf = (file: File | null) => {
    if (file && file.size > CSF_MAX_BYTES) {
      toast.error("La constancia no puede pesar más de 10 MB.");
      return;
    }
    setCsfFile(file);
  };

  const onSubmit = async (values: TaxProfileSchemaValues) => {
    const payload = {
      rfc: values.rfc,
      razon_social: values.razon_social,
      cp_fiscal: values.cp_fiscal,
      regimen_fiscal: values.regimen_fiscal,
      uso_cfdi_default: values.uso_cfdi_default,
      email_recepcion: values.email_recepcion ?? null,
    };

    try {
      if (editing) {
        await updateMutation.mutateAsync({ profile: editing, values: payload, csfFile });
        toast.success(
          csfFile || values.rfc !== editing.rfc
            ? "Datos fiscales actualizados. Vuelve a verificarlos contra la CSF."
            : "Datos fiscales actualizados."
        );
      } else {
        await createMutation.mutateAsync({ values: payload, csfFile });
        toast.success("Datos fiscales guardados.");
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("fis_tax_profiles_client_id_rfc_key")) {
        toast.error("Ese RFC ya está registrado para este cliente.");
        return;
      }
      toast.error(msg || "No se pudieron guardar los datos fiscales.");
    }
  };

  const guardando = createMutation.isPending || updateMutation.isPending;
  const ocupado =
    deactivateMutation.isPending ||
    reactivateMutation.isPending ||
    setDefaultMutation.isPending ||
    verifyMutation.isPending;

  const activos = profiles.filter((p) => p.active);
  const inactivos = profiles.filter((p) => !p.active);

  const correr = async (accion: Promise<unknown>, exito: string) => {
    try {
      await accion;
      toast.success(exito);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo completar la acción.");
    }
  };

  return (
    <section id="datos-fiscales" className="glass-card p-5 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Datos fiscales
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            Con estos datos se llenan los portales de facturación de los comercios donde el cliente
            gasta. Un cliente puede tener varias empresas; el perfil predeterminado es el que se usa
            si nadie elige otro.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 text-[11px] gap-1"
          onClick={abrirAlta}
        >
          <Plus className="h-3 w-3" />
          Agregar datos fiscales
        </Button>
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
        <p className="text-[11px] text-amber-800 dark:text-amber-200">{AVISO_CSF}</p>
      </div>

      {isLoading ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
        </p>
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300">
          No se pudieron cargar los datos fiscales.
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            onClick={() => refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : profiles.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Este cliente todavía no tiene datos fiscales capturados. Sin ellos no se le puede facturar
          ningún gasto.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {activos.map((p) => (
              <ProfileRow
                key={p.id}
                profile={p}
                clientRfc={clientRfc}
                busy={ocupado}
                onEdit={() => abrirEdicion(p)}
                onSetDefault={() =>
                  correr(setDefaultMutation.mutateAsync(p.id), "Perfil marcado como predeterminado.")
                }
                onToggleActive={() =>
                  correr(deactivateMutation.mutateAsync(p.id), "Perfil dado de baja.")
                }
                onToggleVerified={() =>
                  correr(
                    verifyMutation.mutateAsync({ profileId: p.id, verified: !p.csf_verified_at }),
                    p.csf_verified_at ? "Verificación retirada." : "Perfil marcado como verificado."
                  )
                }
              />
            ))}
          </div>

          {inactivos.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Dados de baja</p>
              {inactivos.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  clientRfc={clientRfc}
                  busy={ocupado}
                  onEdit={() => abrirEdicion(p)}
                  onSetDefault={() => undefined}
                  onToggleActive={() =>
                    correr(reactivateMutation.mutateAsync(p.id), "Perfil reactivado.")
                  }
                  onToggleVerified={() =>
                    correr(
                      verifyMutation.mutateAsync({ profileId: p.id, verified: !p.csf_verified_at }),
                      p.csf_verified_at ? "Verificación retirada." : "Perfil marcado como verificado."
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editing ? "Editar datos fiscales" : "Nuevos datos fiscales"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="text-[11px] text-amber-800 dark:text-amber-200">{AVISO_CSF}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField
                control={form.control}
                name="rfc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px]">RFC</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="KACO850315J28"
                        autoCapitalize="characters"
                        className="uppercase"
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormDescription className="text-[10px]">
                      12 caracteres para persona moral, 13 para persona física.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="razon_social"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px]">Razón social</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Tal cual aparece en la CSF" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="cp_fiscal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[12px]">Código postal fiscal</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="06600" inputMode="numeric" maxLength={5} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="uso_cfdi_default"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[12px]">Uso de CFDI por omisión</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Elige un uso" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {C_USO_CFDI.map((u) => (
                            <SelectItem key={u.clave} value={u.clave} className="text-[12px]">
                              {etiquetaCatalogo(u)}
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
                name="regimen_fiscal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px]">Régimen fiscal</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Elige el régimen de la CSF" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {C_REGIMEN_FISCAL.map((r) => (
                          <SelectItem key={r.clave} value={r.clave} className="text-[12px]">
                            {etiquetaCatalogo(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {aviso && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  {aviso}
                </p>
              )}

              <FormField
                control={form.control}
                name="email_recepcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px]">Correo de recepción (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="facturas@cliente.mx" />
                    </FormControl>
                    <FormDescription className="text-[10px]">
                      Algunos portales mandan la factura por correo además de descargarla.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-1.5">
                <label className="text-[12px] font-medium" htmlFor="csf-file">
                  Constancia de Situación Fiscal (PDF)
                </label>
                <Input
                  id="csf-file"
                  type="file"
                  accept="application/pdf"
                  className="text-[12px]"
                  onChange={(e) => elegirCsf(e.target.files?.[0] ?? null)}
                />
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Upload className="h-3 w-3" />
                  {editing?.csf_file_path && !csfFile
                    ? "Ya hay una constancia guardada. Sube otra solo si quieres reemplazarla."
                    : "Se guarda en el almacenamiento privado del módulo y solo se abre con enlaces de 5 minutos."}
                </p>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                  disabled={guardando}
                >
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={guardando} className="gap-1">
                  {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
                  {editing ? "Guardar cambios" : "Guardar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
