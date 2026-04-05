import { useState, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { parseQuickTaskTitle } from "@/lib/quickTaskParse";

interface QuickTaskInputProps {
  projectId?: string;
  clientId?: string;
  area?: string;
  phaseKey?: string;
  placeholder?: string;
  onCreated?: () => void;
}

export function QuickTaskInput({
  projectId, clientId, area, phaseKey, placeholder, onCreated,
}: QuickTaskInputProps) {
  const { user } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const profileRows = useMemo(
    () => profiles.map((p) => ({ user_id: p.user_id, full_name: p.full_name })),
    [profiles],
  );
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask();

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setIsCreating(true);
    try {
      const parsed = parseQuickTaskTitle(trimmed, {
        profiles: profileRows,
        defaultAssignedId: user?.id ?? null,
      });
      await createTask.mutateAsync({
        title: parsed.title,
        project_id: projectId || null,
        client_id: clientId || null,
        area: area || null,
        phase_key: phaseKey || null,
        priority: parsed.priority,
        due_date: parsed.due_date || undefined,
        assigned_to: parsed.assigned_to || undefined,
        status: "pendiente",
      });
      setTitle("");
      onCreated?.();
      inputRef.current?.focus();
    } catch (e: any) {
      toast.error("Error al crear tarea: " + e.message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
          placeholder={
            placeholder ||
            "Tarea rápida… #urgente @nombre viernes (Enter)"
          }
          className="pl-8 h-9 text-sm"
          disabled={isCreating}
        />
      </div>
      {title.trim() && (
        <Button size="sm" onClick={handleCreate} disabled={isCreating} className="shrink-0 h-9">
          {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Crear"}
        </Button>
      )}
    </div>
  );
}
