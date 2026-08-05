import { useState, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, AlertTriangle } from "lucide-react";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { findSimilarTasks, type SimilarTaskCandidate } from "@/lib/taskSimilarity";
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
  const [dupeMatches, setDupeMatches] = useState<Array<SimilarTaskCandidate & { score: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask();

  // Candidatos para detección de duplicados (mismo proyecto, o cliente si no hay proyecto).
  const { data: dupeCandidates = [] } = useQuery({
    queryKey: ["dupe-candidates", projectId || null, clientId || null],
    enabled: !!projectId || !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from("tasks")
        .select("id, title, status, area, is_recurring")
        .in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (projectId) q = q.eq("project_id", projectId);
      else if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SimilarTaskCandidate[];
    },
  });

  const doCreate = async () => {
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
      setDupeMatches([]);
      onCreated?.();
      inputRef.current?.focus();
    } catch (e: any) {
      toast.error("Error al crear tarea: " + e.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Al parsear se limpian #prioridad/@persona/fechas para comparar solo el concepto.
    const parsedTitle = parseQuickTaskTitle(trimmed, { profiles: profileRows, defaultAssignedId: user?.id ?? null }).title;
    const matches = findSimilarTasks(parsedTitle, dupeCandidates, { area: area || null, threshold: 0.7 });
    if (matches.length > 0) {
      setDupeMatches(matches);
      return;
    }
    await doCreate();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (dupeMatches.length) setDupeMatches([]); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
            placeholder={
              placeholder ||
              "Tarea rápida… #urgente @nombre viernes (Enter)"
            }
            className="pl-8 h-9 text-sm"
            disabled={isCreating}
          />
        </div>
        {title.trim() && dupeMatches.length === 0 && (
          <Button size="sm" onClick={handleCreate} disabled={isCreating} className="shrink-0 h-9">
            {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Crear"}
          </Button>
        )}
      </div>

      {dupeMatches.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-2.5 space-y-2 text-left">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                Ya existe{dupeMatches.length > 1 ? "n" : ""} {dupeMatches.length} tarea{dupeMatches.length > 1 ? "s" : ""} parecida{dupeMatches.length > 1 ? "s" : ""}:
              </p>
              <ul className="mt-1 space-y-0.5">
                {dupeMatches.slice(0, 4).map((m) => (
                  <li key={m.id} className="text-xs text-muted-foreground truncate" title={m.title}>
                    • {m.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setDupeMatches([])}>
              Revisar
            </Button>
            <Button type="button" size="sm" className="h-7" disabled={isCreating} onClick={() => void doCreate()}>
              {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Es otra, crear"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
