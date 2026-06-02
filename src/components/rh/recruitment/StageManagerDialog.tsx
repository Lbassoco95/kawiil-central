import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUp, ArrowDown, Trash2, Plus, Check } from "lucide-react";
import type { RecruitmentStage } from "@/lib/recruitment";
import {
  useCreateStage,
  useRenameStage,
  useDeleteStage,
  useReorderStages,
} from "@/hooks/useRecruitment";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processId: string;
  stages: RecruitmentStage[];
}

export function StageManagerDialog({ open, onOpenChange, processId, stages }: Props) {
  const createStage = useCreateStage();
  const rename = useRenameStage();
  const remove = useDeleteStage();
  const reorder = useReorderStages();
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const move = (index: number, dir: -1 | 1) => {
    const next = [...stages];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({ processId, ordered: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Fases del proceso</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {stages.map((s, i) => {
            const draft = drafts[s.id] ?? s.name;
            const dirty = draft.trim() !== s.name && draft.trim().length > 0;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <Input
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  className="h-8 text-sm"
                />
                {dirty && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                    onClick={() => rename.mutate({ id: s.id, name: draft.trim(), processId })}>
                    <Check className="h-4 w-4 text-emerald-600" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600"
                  onClick={() => remove.mutate({ id: s.id, processId })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          <div className="flex items-center gap-1.5 pt-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nueva fase"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  createStage.mutate({ processId, name: newName.trim(), position: stages.length });
                  setNewName("");
                }
              }}
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={!newName.trim() || createStage.isPending}
              onClick={() => {
                createStage.mutate({ processId, name: newName.trim(), position: stages.length });
                setNewName("");
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
