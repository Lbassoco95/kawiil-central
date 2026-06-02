import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ABSENCE_TYPES,
  ABSENCE_TYPE_EMOJI,
  ABSENCE_TYPE_LABEL,
  DAY_PARTS,
  DAY_PART_LABEL,
  type RhAbsenceType,
  type RhDayPart,
} from "@/lib/rh";
import { useCreateAbsenceRequest, useMyCelulas } from "@/hooks/useRh";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AbsenceRequestDialog({ open, onOpenChange }: Props) {
  const create = useCreateAbsenceRequest();
  const { data: celulas = [] } = useMyCelulas();

  const [absenceType, setAbsenceType] = useState<RhAbsenceType>("vacaciones");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dayPart, setDayPart] = useState<RhDayPart>("full_day");
  const [celulaId, setCelulaId] = useState<string>("");
  const [reason, setReason] = useState("");

  const isSingleDay = !!startDate && startDate === endDate;

  useEffect(() => {
    if (!open) return;
    setAbsenceType("vacaciones");
    setStartDate("");
    setEndDate("");
    setDayPart("full_day");
    setReason("");
    setCelulaId(celulas[0]?.id ?? "");
  }, [open, celulas]);

  // Medio día solo aplica a un único día.
  useEffect(() => {
    if (!isSingleDay && dayPart !== "full_day") setDayPart("full_day");
  }, [isSingleDay, dayPart]);

  const responsibleHint = useMemo(() => {
    const c = celulas.find((x) => x.id === celulaId);
    if (!c) return null;
    if (!c.responsible_user_id) return "Esta célula no tiene G4 responsable asignado; avisa a tu líder.";
    return null;
  }, [celulas, celulaId]);

  function handleSubmit() {
    if (!startDate || !endDate) {
      toast.error("Indica las fechas.");
      return;
    }
    if (endDate < startDate) {
      toast.error("La fecha fin no puede ser anterior al inicio.");
      return;
    }
    create.mutate(
      {
        absence_type: absenceType,
        start_date: startDate,
        end_date: endDate,
        day_part: dayPart,
        celula_id: celulaId || null,
        reason: reason.trim() || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva solicitud</DialogTitle>
          <DialogDescription>
            La aprueba el G4 responsable de tu célula. Recibirás un aviso con la decisión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={absenceType} onValueChange={(v) => setAbsenceType(v as RhAbsenceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ABSENCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ABSENCE_TYPE_EMOJI[t]} {ABSENCE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Desde</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hasta</Label>
              <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Parte del día</Label>
            <Select value={dayPart} onValueChange={(v) => setDayPart(v as RhDayPart)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAY_PARTS.map((p) => (
                  <SelectItem key={p} value={p} disabled={p !== "full_day" && !isSingleDay}>
                    {DAY_PART_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isSingleDay && (
              <p className="text-xs text-muted-foreground">El medio día solo aplica a un único día.</p>
            )}
          </div>

          {celulas.length > 1 && (
            <div className="space-y-1.5">
              <Label>Célula</Label>
              <Select value={celulaId} onValueChange={setCelulaId}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>
                  {celulas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Motivo (opcional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>

          {responsibleHint && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              {responsibleHint}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
