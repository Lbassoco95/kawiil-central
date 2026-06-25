import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, UserCheck } from "lucide-react";
import { useConvertCandidate } from "@/hooks/useOnboarding";
import { useCelulas } from "@/hooks/useCatalogs";
import { GRADO_SELECT_OPTIONS, gradoFromGrade } from "@/lib/gradoLabels";
import type { Candidate, RecruitmentState } from "@/lib/recruitment";

/** Dominio empresarial obligatorio para la cuenta del colaborador. */
const CORP_DOMAIN = "kawiil.mx";

/** Quita acentos y deja solo letras minúsculas. */
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Sugiere un correo empresarial (inicial del nombre + apellido) a partir del nombre completo. */
function suggestCorporateEmail(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const initial = normalizeName(parts[0]).charAt(0);
  const lastName = normalizeName(parts[parts.length - 1]);
  if (!initial || !lastName) return "";
  return `${initial}${lastName}@${CORP_DOMAIN}`;
}

/** Valida que sea un correo del dominio empresarial. */
function isValidCorporateEmail(email: string): boolean {
  return new RegExp(`^[^\\s@]+@${CORP_DOMAIN.replace(/\./g, "\\.")}$`, "i").test(email.trim());
}

/**
 * Contrata a un candidato e inicia su onboarding: crea la cuenta en kawiil-central,
 * le envía el correo de acceso, lo asigna a una célula y siembra su lista de bienvenida.
 */
export function HireCandidateDialog({
  candidate,
  states,
  defaultGrade,
  open,
  onOpenChange,
}: {
  candidate: Candidate | null;
  states: RecruitmentState[];
  /** Grado de la vacante ("G1".."G4") para predefinir el grado del colaborador. */
  defaultGrade?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const convert = useConvertCandidate();
  const { data: celulas = [], isLoading: loadingCelulas } = useCelulas();
  const [role, setRole] = useState<string>("ejecutor");
  const [celulaId, setCelulaId] = useState<string>("");
  const [corporateEmail, setCorporateEmail] = useState<string>("");

  // Al abrir, predefine el grado según la vacante (G1→En formación, etc.) y
  // sugiere el correo empresarial a partir del nombre del candidato.
  useEffect(() => {
    if (open) {
      setRole(gradoFromGrade(defaultGrade) ?? "ejecutor");
      setCorporateEmail(suggestCorporateEmail(candidate?.full_name ?? ""));
    }
  }, [open, defaultGrade, candidate?.full_name]);

  const corpEmailValid = isValidCorporateEmail(corporateEmail);

  const activeCelulas = celulas.filter((c) => c.is_active);
  const contratadoStateId = states.find((s) => s.name.toLowerCase().includes("contratad"))?.id ?? null;

  if (!candidate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" /> Contratar e iniciar onboarding
          </DialogTitle>
          <DialogDescription>
            Se creará la cuenta de <strong>{candidate.full_name}</strong> con su correo empresarial,
            se le enviará ahí el enlace de acceso a kawiil-central y se iniciará su lista de bienvenida.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Correo empresarial (cuenta de acceso)</Label>
            <Input
              type="email"
              value={corporateEmail}
              onChange={(e) => setCorporateEmail(e.target.value)}
              placeholder={`nombre@${CORP_DOMAIN}`}
              className="h-9 text-sm"
              autoComplete="off"
            />
            {corporateEmail && !corpEmailValid ? (
              <p className="text-[10px] text-destructive">
                Debe ser un correo válido del dominio @{CORP_DOMAIN}.
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Con este correo se crea la cuenta y se manda el acceso.
                {candidate.email ? ` El personal (${candidate.email}) queda solo como contacto.` : ""}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Grado inicial (Kawiiler)</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GRADO_SELECT_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Célula</Label>
            <Select value={celulaId} onValueChange={setCelulaId} disabled={loadingCelulas}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={loadingCelulas ? "Cargando…" : "Selecciona una célula (opcional)"} />
              </SelectTrigger>
              <SelectContent>
                {activeCelulas.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">El colaborador queda vinculado a esta célula.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!corpEmailValid || convert.isPending}
            onClick={() =>
              convert.mutate(
                {
                  candidate,
                  role,
                  celulaId: celulaId || null,
                  contratadoStateId,
                  loginEmail: corporateEmail.trim().toLowerCase(),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {convert.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Contratar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
