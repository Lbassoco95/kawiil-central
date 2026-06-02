import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Check } from "lucide-react";
import {
  useOnboardingTemplate,
  useCreateTemplateItem,
  useUpdateTemplateItem,
  useDeleteTemplateItem,
} from "@/hooks/useOnboarding";

export function OnboardingTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: items = [] } = useOnboardingTemplate();
  const create = useCreateTemplateItem();
  const update = useUpdateTemplateItem();
  const remove = useDeleteTemplateItem();
  const [newLabel, setNewLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Plantilla de bienvenida</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Estos pasos se copian al checklist de cada colaborador nuevo al contratarlo.
        </p>
        <div className="space-y-2">
          {items.map((it) => {
            const draft = drafts[it.id] ?? it.label;
            const dirty = draft.trim() !== it.label && draft.trim().length > 0;
            return (
              <div key={it.id} className="flex items-center gap-1.5">
                <Input
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                  className="h-8 text-sm"
                />
                {dirty && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                    onClick={() => update.mutate({ id: it.id, label: draft.trim() })}>
                    <Check className="h-4 w-4 text-emerald-600" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600"
                  onClick={() => remove.mutate(it.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          <div className="flex items-center gap-1.5 pt-1">
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nuevo paso"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newLabel.trim()) {
                  create.mutate({ label: newLabel.trim(), position: items.length });
                  setNewLabel("");
                }
              }}
            />
            <Button size="icon" className="h-8 w-8 shrink-0" disabled={!newLabel.trim() || create.isPending}
              onClick={() => { create.mutate({ label: newLabel.trim(), position: items.length }); setNewLabel(""); }}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
