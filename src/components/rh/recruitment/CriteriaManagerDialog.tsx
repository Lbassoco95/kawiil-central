import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Check } from "lucide-react";
import type { RecruitmentCriterion } from "@/lib/recruitment";
import { useCreateCriterion, useUpdateCriterion, useDeleteCriterion } from "@/hooks/useRecruitment";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processId: string;
  criteria: RecruitmentCriterion[];
}

export function CriteriaManagerDialog({ open, onOpenChange, processId, criteria }: Props) {
  const create = useCreateCriterion();
  const update = useUpdateCriterion();
  const remove = useDeleteCriterion();
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { name: string; weight: string }>>({});

  const totalWeight = criteria.reduce((s, c) => s + Number(c.weight), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Rúbrica de evaluación</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Cada criterio se califica de 1 a 5. El peso define cuánto influye en la calificación final.
        </p>
        <div className="space-y-2">
          {criteria.map((c) => {
            const draft = drafts[c.id] ?? { name: c.name, weight: String(c.weight) };
            const dirty =
              (draft.name.trim() !== c.name && draft.name.trim().length > 0) ||
              Number(draft.weight) !== Number(c.weight);
            const pct = totalWeight > 0 ? Math.round((Number(c.weight) / totalWeight) * 100) : 0;
            return (
              <div key={c.id} className="flex items-center gap-1.5">
                <Input
                  value={draft.name}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: { ...draft, name: e.target.value } }))}
                  className="h-8 flex-1 text-sm"
                />
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={draft.weight}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: { ...draft, weight: e.target.value } }))}
                  className="h-8 w-16 text-sm"
                />
                <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">{pct}%</span>
                {dirty && (
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                    onClick={() => update.mutate({ id: c.id, name: draft.name.trim(), weight: Number(draft.weight) || 0, processId })}
                  >
                    <Check className="h-4 w-4 text-emerald-600" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600"
                  onClick={() => remove.mutate({ id: c.id, processId })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          <div className="flex items-center gap-1.5 pt-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nuevo criterio"
              className="h-8 flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  create.mutate({ processId, name: newName.trim(), weight: 1, position: criteria.length });
                  setNewName("");
                }
              }}
            />
            <Button
              size="icon" className="h-8 w-8 shrink-0"
              disabled={!newName.trim() || create.isPending}
              onClick={() => {
                create.mutate({ processId, name: newName.trim(), weight: 1, position: criteria.length });
                setNewName("");
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Label className="text-[10px] text-muted-foreground">Peso total: {totalWeight}</Label>
      </DialogContent>
    </Dialog>
  );
}
