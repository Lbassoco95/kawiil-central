import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  KeyRound,
  ShieldCheck,
  Upload,
  Trash2,
  Loader2,
  Plus,
  AlertTriangle,
  CalendarClock,
  Stamp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateMX } from "@/lib/dateUtils";
import {
  fileToBase64,
  isRfcMismatchError,
  useClientSatCertificates,
  useDeleteClientSatCertificate,
  useSaveClientSatCertificate,
  type SatCertType,
  type SatCertificateSummary,
} from "@/hooks/useClientSatCertificates";

interface ClientSatCertificatesSectionProps {
  clientId: string;
  clientRfc: string | null;
}

interface ExpiryStyle {
  badgeClass: string;
  label: string;
  icon: typeof CalendarClock;
}

function expiryStyle(daysLeft: number | null): ExpiryStyle {
  if (daysLeft == null) {
    return {
      badgeClass:
        "bg-muted text-muted-foreground border border-muted-foreground/20",
      label: "Sin vigencia",
      icon: CalendarClock,
    };
  }
  if (daysLeft <= 0) {
    return {
      badgeClass:
        "bg-destructive/15 text-destructive border border-destructive/30",
      label: "VENCIDO",
      icon: AlertTriangle,
    };
  }
  if (daysLeft <= 15) {
    return {
      badgeClass:
        "bg-destructive/10 text-destructive border border-destructive/30",
      label: `Vence en ${daysLeft} d`,
      icon: AlertTriangle,
    };
  }
  if (daysLeft <= 30) {
    return {
      badgeClass:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
      label: `Vence en ${daysLeft} d`,
      icon: CalendarClock,
    };
  }
  return {
    badgeClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
    label: `Vigente · ${daysLeft} d`,
    icon: ShieldCheck,
  };
}

function CertRow({
  cert,
  onReplace,
  onDelete,
  isDeleting,
}: {
  cert: SatCertificateSummary;
  onReplace: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const style = expiryStyle(cert.daysLeft);
  const Icon = style.icon;
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-foreground">
              {cert.label?.trim() ||
                (cert.certType === "fiel" ? "e.firma del cliente" : "Sello digital")}
            </span>
            <Badge
              variant="outline"
              className={cn("text-[10px] gap-1 font-normal", style.badgeClass)}
            >
              <Icon className="h-3 w-3" />
              {style.label}
            </Badge>
            {cert.certType === "fiel" ? (
              cert.satgoJweReady ? (
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                >
                  Lista para SATgo (JWE)
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                >
                  Falta contraseña (reemplazar e.firma)
                </Badge>
              )
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {cert.certSubjectRfc ? (
              <span>
                RFC: <code className="text-[11px] text-foreground/80">{cert.certSubjectRfc}</code>
              </span>
            ) : null}
            {cert.certSerial ? (
              <span title={cert.certSerial}>
                Serie: <code className="text-[10px]">…{cert.certSerial.slice(-12)}</code>
              </span>
            ) : null}
            {cert.certNotAfter ? (
              <span>Hasta {formatDateMX(cert.certNotAfter)}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1"
            onClick={onReplace}
          >
            <Upload className="h-3 w-3" />
            Reemplazar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-destructive gap-1"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Quitar
          </Button>
        </div>
      </div>
    </div>
  );
}

interface UploadDialogState {
  open: boolean;
  certType: SatCertType;
  replacingId: string | null;
}

export function ClientSatCertificatesSection({
  clientId,
  clientRfc,
}: ClientSatCertificatesSectionProps) {
  const { data, isLoading, isError, refetch } = useClientSatCertificates(clientId);
  const saveMutation = useSaveClientSatCertificate(clientId);
  const deleteMutation = useDeleteClientSatCertificate(clientId);

  const [dialog, setDialog] = useState<UploadDialogState>({
    open: false,
    certType: "fiel",
    replacingId: null,
  });
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [keyPassword, setKeyPassword] = useState("");
  const [label, setLabel] = useState<string>("");
  const [forceRfc, setForceRfc] = useState<boolean>(false);
  const [pendingMismatch, setPendingMismatch] = useState<{
    certificateRfc: string | null;
    clientRfc: string | null;
  } | null>(null);

  const fiel = data?.fiel ?? null;
  const csds = useMemo(() => data?.csds ?? [], [data?.csds]);

  const openUpload = (
    certType: SatCertType,
    replacingId: string | null,
    initialLabel?: string,
  ) => {
    setDialog({ open: true, certType, replacingId });
    setCerFile(null);
    setKeyFile(null);
    setKeyPassword("");
    setLabel(initialLabel ?? "");
    setForceRfc(false);
    setPendingMismatch(null);
  };

  const closeUpload = () => {
    setDialog({ open: false, certType: dialog.certType, replacingId: null });
    setCerFile(null);
    setKeyFile(null);
    setKeyPassword("");
    setLabel("");
    setForceRfc(false);
    setPendingMismatch(null);
  };

  const handleSubmit = async () => {
    if (!cerFile || !keyFile) {
      toast.error("Selecciona el archivo .cer y el .key");
      return;
    }
    if (dialog.certType === "fiel" && !keyPassword.trim()) {
      toast.error("Indica la contraseña de la e.firma (se cifra a JWE para SATgo)");
      return;
    }
    try {
      const certificateBase64 = await fileToBase64(cerFile);
      const privateKeyBase64 = await fileToBase64(keyFile);
      await saveMutation.mutateAsync({
        clientId,
        certType: dialog.certType,
        certificateBase64,
        privateKeyBase64,
        privateKeyPassword:
          dialog.certType === "fiel" ? keyPassword.trim() : undefined,
        label: dialog.certType === "csd_sello" ? label.trim() || null : null,
        forceRfcMismatch: forceRfc,
      });
      toast.success(
        dialog.certType === "fiel"
          ? "e.firma guardada. Llave y contraseña cifradas (JWE) para SATgo."
          : "Sello digital guardado (cifrado).",
      );
      closeUpload();
    } catch (e) {
      if (isRfcMismatchError(e)) {
        setPendingMismatch({
          certificateRfc: e.certificateRfc,
          clientRfc: e.clientRfc,
        });
        return;
      }
      toast.error(
        e instanceof Error ? e.message : "No se pudo guardar el certificado",
      );
    }
  };

  const handleDelete = (cert: SatCertificateSummary) => {
    const label =
      cert.certType === "fiel"
        ? "la e.firma (FIEL) del cliente"
        : `el sello digital${cert.label ? ` "${cert.label}"` : ""}`;
    if (!window.confirm(`Eliminar ${label}? Esta accion no se puede deshacer.`)) {
      return;
    }
    deleteMutation.mutate(
      { certificateId: cert.id },
      {
        onSuccess: () => toast.success("Certificado eliminado."),
        onError: (e) =>
          toast.error(
            e instanceof Error ? e.message : "No se pudo eliminar el certificado",
          ),
      },
    );
  };

  return (
    <section
      id="sat-certificates"
      className="glass-card p-5 md:col-span-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            Certificados SAT del cliente
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            Sube la e.firma (FIEL) con su contraseña: la llave y la contraseña se cifran a JWE
            con la llave pública de SATgo (solo ellos pueden abrirlas) para CSF y 32D. Los sellos
            digitales (CSD) se guardan cifrados en Kawiil y avisamos antes de que venzan.
          </p>
        </div>
        {!isLoading && !isError ? (
          <div className="flex items-center gap-1.5">
            {!fiel ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-[11px] gap-1"
                onClick={() => openUpload("fiel", null)}
              >
                <Upload className="h-3 w-3" />
                Subir e.firma
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              onClick={() => openUpload("csd_sello", null)}
            >
              <Plus className="h-3 w-3" />
              Agregar sello digital
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Comprobando…
        </p>
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300">
          No se pudieron cargar los certificados.
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
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="text-[11px] font-medium text-foreground/80 mb-2 flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-muted-foreground" />
              e.firma (FIEL)
            </h3>
            {fiel ? (
              <CertRow
                cert={fiel}
                onReplace={() => openUpload("fiel", fiel.id)}
                onDelete={() => handleDelete(fiel)}
                isDeleting={
                  deleteMutation.isPending &&
                  (deleteMutation.variables as { certificateId?: string })?.certificateId === fiel.id
                }
              />
            ) : (
              <p className="text-[11px] text-muted-foreground italic">
                Sin e.firma cargada. Necesaria para tramites SAT del cliente.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-[11px] font-medium text-foreground/80 mb-2 flex items-center gap-1.5">
              <Stamp className="h-3 w-3 text-muted-foreground" />
              Sellos digitales (CSD) — {csds.length}
            </h3>
            {csds.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                Sin sellos digitales. Agrega uno por matriz y por cada sucursal.
              </p>
            ) : (
              <div className="space-y-2">
                {csds.map((c) => (
                  <CertRow
                    key={c.id}
                    cert={c}
                    onReplace={() => openUpload("csd_sello", c.id, c.label ?? "")}
                    onDelete={() => handleDelete(c)}
                    isDeleting={
                      deleteMutation.isPending &&
                      (deleteMutation.variables as { certificateId?: string })?.certificateId ===
                        c.id
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) closeUpload();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dialog.certType === "fiel"
                ? dialog.replacingId
                  ? "Reemplazar e.firma (FIEL)"
                  : "Subir e.firma (FIEL)"
                : dialog.replacingId
                  ? "Reemplazar sello digital (CSD)"
                  : "Agregar sello digital (CSD)"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {dialog.certType === "csd_sello" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Alias / sucursal (opcional)</Label>
                <Input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder='Ej. "Matriz", "Suc. Cancun"'
                  className="text-xs h-9"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label className="text-xs">Certificado (.cer)</Label>
              <Input
                type="file"
                accept=".cer,.crt"
                className="text-xs h-9"
                onChange={(e) => setCerFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Llave privada (.key)</Label>
              <Input
                type="file"
                accept=".key"
                className="text-xs h-9"
                onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {dialog.certType === "fiel" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Contraseña de la e.firma <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={keyPassword}
                  onChange={(e) => setKeyPassword(e.target.value)}
                  placeholder="Obligatoria — se cifra a JWE para SATgo"
                  className="text-xs h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Requerida para CSF/32D. Se cifra con la llave pública de SATgo y no se guarda en claro.
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                La contraseña del sello no se guarda. La vigencia se extrae del certificado.
              </p>
            )}
            {clientRfc ? (
              <p className="text-[10px] text-muted-foreground">
                RFC del cliente:{" "}
                <code className="text-[10px] bg-muted/60 px-1 rounded">{clientRfc}</code>
              </p>
            ) : (
              <p className="text-[10px] text-amber-700 dark:text-amber-300">
                El cliente no tiene RFC registrado. Recomendado agregarlo antes para validar
                automaticamente el certificado.
              </p>
            )}
            {pendingMismatch ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
                <p className="text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  El RFC del certificado{" "}
                  <code className="text-[10px]">
                    {pendingMismatch.certificateRfc ?? "?"}
                  </code>{" "}
                  no coincide con el del cliente{" "}
                  <code className="text-[10px]">{pendingMismatch.clientRfc ?? "?"}</code>.
                </p>
                <label className="flex items-center gap-1.5 text-[10px] text-amber-800 dark:text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forceRfc}
                    onChange={(e) => setForceRfc(e.target.checked)}
                  />
                  Es una sucursal o RFC alterno valido, guardar de todas formas.
                </label>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={closeUpload}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                saveMutation.isPending ||
                !cerFile ||
                !keyFile ||
                (dialog.certType === "fiel" && !keyPassword.trim()) ||
                (!!pendingMismatch && !forceRfc)
              }
              onClick={handleSubmit}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : dialog.certType === "fiel" ? (
                "Guardar para SATgo"
              ) : (
                "Guardar cifrado"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
