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

  // Al abrir, predefine el grado según la vacante (G1→En formación, etc.).
  useEffect(() => {
    if (open) setRole(gradoFromGrade(defaultGrade) ?? "ejecutor");
  }, [open, defaultGrade]);

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
            Se creará la cuenta de <strong>{candidate.full_name}</strong> ({candidate.email ?? "sin correo"}),
            se le enviará el correo con sus accesos a kawiil-central y se iniciará su lista de bienvenida.
          </DialogDescription>
        </DialogHeader>

        {!candidate.email && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            El candidato no tiene correo. Agrégalo en la ficha antes de contratarlo.
          </p>
        )}

        <div className="space-y-3 py-1">
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
            disabled={!candidate.email || convert.isPending}
            onClick={() =>
              convert.mutate(
                { candidate, role, celulaId: celulaId || null, contratadoStateId },
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
