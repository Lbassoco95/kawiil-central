import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useSaveGoal, type SavingsGoal } from "@/hooks/useBankFinance";
import { parseMoney } from "@/lib/bankStatement";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  goal: SavingsGoal | null;
}

export function SavingsGoalDialog({ open, onOpenChange, goal }: Props) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("");
  const [date, setDate] = useState("");
  const save = useSaveGoal();

  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? "");
    setTarget(goal ? String(goal.target_amount) : "");
    setSaved(goal ? String(goal.saved_amount) : "0");
    setDate(goal?.target_date ?? "");
  }, [open, goal]);

  const targetN = parseMoney(target);
  const savedN = parseMoney(saved) ?? 0;
  const valid = name.trim().length > 0 && targetN != null && targetN > 0 && savedN >= 0;

  const submit = async () => {
    if (!valid || targetN == null) return;
    try {
      await save.mutateAsync({
        id: goal?.id,
        name: name.trim(),
        target_amount: targetN,
        saved_amount: savedN,
        target_date: date || null,
      });
      toast.success("Meta guardada con calma");
      onOpenChange(false);
    } catch (e) {
      toast.error("No pudimos guardar la meta", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="zen-dialog zen-dash max-w-md">
        <DialogHeader>
          <DialogTitle>{goal ? "Editar meta de ahorro" : "Nueva meta de ahorro"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Para qué estamos ahorrando</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Colchón de 3 meses, impuestos, aguinaldos" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Meta (MXN)</Label>
              <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ya apartado (MXN)</Label>
              <Input inputMode="decimal" value={saved} onChange={(e) => setSaved(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha objetivo (opcional)</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Con fecha calculamos cuánto apartar cada mes.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || save.isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
