import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Check, X, Loader2 } from "lucide-react";
import {
  useEmailUserLabels,
  useCreateEmailLabel,
  useEmailLabelAssignments,
  useAddEmailLabelAssignment,
  useRemoveEmailLabelAssignment,
} from "@/hooks/useMicrosoft";
import { cn } from "@/lib/utils";

export const LABEL_COLORS = [
  { key: "blue",    bg: "hsl(210 100% 47% / 0.15)", text: "hsl(210 100% 47%)", dot: "hsl(210 100% 47%)" },
  { key: "indigo",  bg: "hsl(239 84% 60% / 0.15)",  text: "hsl(239 84% 60%)",  dot: "hsl(239 84% 60%)" },
  { key: "purple",  bg: "hsl(272 65% 55% / 0.15)",  text: "hsl(272 65% 55%)",  dot: "hsl(272 65% 55%)" },
  { key: "pink",    bg: "hsl(330 80% 55% / 0.15)",  text: "hsl(330 80% 55%)",  dot: "hsl(330 80% 55%)" },
  { key: "red",     bg: "hsl(0 72% 51% / 0.15)",    text: "hsl(0 72% 51%)",    dot: "hsl(0 72% 51%)" },
  { key: "orange",  bg: "hsl(32 90% 48% / 0.15)",   text: "hsl(32 90% 48%)",   dot: "hsl(32 90% 48%)" },
  { key: "yellow",  bg: "hsl(47 95% 48% / 0.15)",   text: "hsl(47 95% 48%)",   dot: "hsl(47 95% 48%)" },
  { key: "lime",    bg: "hsl(84 70% 40% / 0.15)",   text: "hsl(84 70% 40%)",   dot: "hsl(84 70% 40%)" },
  { key: "green",   bg: "hsl(142 71% 45% / 0.15)",  text: "hsl(142 71% 45%)",  dot: "hsl(142 71% 45%)" },
  { key: "teal",    bg: "hsl(172 66% 40% / 0.15)",  text: "hsl(172 66% 40%)",  dot: "hsl(172 66% 40%)" },
  { key: "cyan",    bg: "hsl(196 80% 45% / 0.15)",  text: "hsl(196 80% 45%)",  dot: "hsl(196 80% 45%)" },
  { key: "slate",   bg: "hsl(215 20% 50% / 0.15)",  text: "hsl(215 20% 50%)",  dot: "hsl(215 20% 50%)" },
];

export function getLabelStyle(color: string) {
  return LABEL_COLORS.find(c => c.key === color) ?? LABEL_COLORS[0];
}

interface Props {
  emailMessageId: string;
  children: React.ReactNode;
}

export function MailLabelPicker({ emailMessageId, children }: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [creating, setCreating] = useState(false);

  const { data: labels = [] } = useEmailUserLabels();
  const { data: assignments = [] } = useEmailLabelAssignments(open ? emailMessageId : null);
  const createLabel = useCreateEmailLabel();
  const addAssignment = useAddEmailLabelAssignment();
  const removeAssignment = useRemoveEmailLabelAssignment();

  const assignedLabelIds = new Set(assignments.map(a => a.label_id));

  const handleToggle = (labelId: string) => {
    if (assignedLabelIds.has(labelId)) {
      removeAssignment.mutate({ emailMessageId, labelId });
    } else {
      addAssignment.mutate({ emailMessageId, labelId });
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const label = await createLabel.mutateAsync({ name: newName.trim(), color: newColor });
    if (label?.id) {
      addAssignment.mutate({ emailMessageId, labelId: label.id });
    }
    setNewName("");
    setNewColor("blue");
    setCreating(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-[220px] p-2">
        <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground px-1 pb-2">
          Etiquetas
        </p>
        <div className="space-y-0.5">
          {labels.map(label => {
            const style = getLabelStyle(label.color);
            const assigned = assignedLabelIds.has(label.id);
            return (
              <button
                key={label.id}
                onClick={() => handleToggle(label.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: style.dot }} />
                <span className="flex-1 text-[12.5px] truncate">{label.name}</span>
                {assigned && <Check className="w-3 h-3 text-primary shrink-0" />}
              </button>
            );
          })}
          {labels.length === 0 && !creating && (
            <p className="text-[12px] text-muted-foreground/60 px-2 py-1">Sin etiquetas</p>
          )}
        </div>
        {creating ? (
          <div className="mt-2 border-t border-border/30 pt-2 space-y-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { void handleCreate(); } if (e.key === "Escape") setCreating(false); }}
              placeholder="Nombre de etiqueta"
              className="w-full h-7 px-2 text-[12px] bg-muted/50 border border-border/50 rounded outline-none focus:border-primary/40"
            />
            <div className="grid grid-cols-6 gap-1.5">
              {LABEL_COLORS.map(c => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  title={c.key}
                  className={cn("w-5 h-5 rounded-full transition-transform", newColor === c.key && "scale-125 ring-2 ring-offset-1 ring-primary")}
                  style={{ background: c.dot }}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => { void handleCreate(); }}
                disabled={!newName.trim() || createLabel.isPending}
                className="flex-1 h-7 text-[11.5px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {createLabel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Crear"}
              </button>
              <button
                onClick={() => setCreating(false)}
                title="Cancelar"
                className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="mt-2 w-full flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors border-t border-border/30 pt-2"
          >
            <Plus className="w-3 h-3" />
            Nueva etiqueta
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
