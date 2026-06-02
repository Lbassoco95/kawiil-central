import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATE_COLORS,
  STATE_COLOR_STYLE,
  type RecruitmentState,
} from "@/lib/recruitment";
import { useCreateState, useUpdateState, useDeleteState } from "@/hooks/useRecruitment";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processId: string;
  states: RecruitmentState[];
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1">
      {STATE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "h-5 w-5 rounded-full border-2",
            STATE_COLOR_STYLE[c],
            value === c ? "ring-2 ring-offset-1 ring-foreground/40" : "opacity-60",
          )}
          aria-label={c}
        />
      ))}
    </div>
  );
}

export function StateManagerDialog({ open, onOpenChange, processId, states }: Props) {
  const create = useCreateState();
  const update = useUpdateState();
  const remove = useDeleteState();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("sky");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Estados de candidatos</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {states.map((s) => {
            const draft = drafts[s.id] ?? s.name;
            const dirty = draft.trim() !== s.name && draft.trim().length > 0;
            return (
              <div key={s.id} className="space-y-1.5 rounded-lg border p-2">
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={cn("shrink-0", STATE_COLOR_STYLE[s.color] ?? STATE_COLOR_STYLE.slate)}>
                    {s.name}
                  </Badge>
                  <Input
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                    className="h-8 text-sm"
                  />
                  {dirty && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                      onClick={() => update.mutate({ id: s.id, name: draft.trim(), processId })}>
                      <Check className="h-4 w-4 text-emerald-600" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600"
                    onClick={() => remove.mutate({ id: s.id, processId })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <ColorPicker value={s.color} onChange={(color) => update.mutate({ id: s.id, color, processId })} />
              </div>
            );
          })}

          <div className="space-y-1.5 rounded-lg border border-dashed p-2">
            <div className="flex items-center gap-1.5">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nuevo estado"
                className="h-8 text-sm"
              />
              <Button
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={!newName.trim() || create.isPending}
                onClick={() => {
                  create.mutate({ processId, name: newName.trim(), color: newColor, position: states.length });
                  setNewName("");
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <ColorPicker value={newColor} onChange={setNewColor} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
