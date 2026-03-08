import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const INTERNAL_PROCEDURES_PATH = "internal/procedures";

export function useInternalProcedures() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["internal-procedures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("internal_procedures")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateInternalProcedure() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { title: string; description?: string; file: File }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización");

      const filePath = `${INTERNAL_PROCEDURES_PATH}/${Date.now()}_${input.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, input.file);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("internal_procedures")
        .insert({
          organization_id: profile.organization_id,
          title: input.title,
          description: input.description || null,
          file_path: filePath,
          file_size: input.file.size,
          mime_type: input.file.type,
          uploaded_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      toast.success("Procedimiento subido");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInternalProcedure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (row: { id: string; file_path: string }) => {
      await supabase.storage.from("documents").remove([row.file_path]);
      const { error } = await supabase.from("internal_procedures").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      toast.success("Procedimiento eliminado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useInternalComunicados() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["internal-comunicados"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("internal_comunicados")
        .select("*")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateInternalComunicado() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { title: string; body?: string; is_pinned?: boolean }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización");

      const { data, error } = await supabase
        .from("internal_comunicados")
        .insert({
          organization_id: profile.organization_id,
          title: input.title,
          body: input.body || null,
          is_pinned: input.is_pinned ?? false,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-comunicados"] });
      toast.success("Comunicado publicado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInternalComunicado() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("internal_comunicados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-comunicados"] });
      toast.success("Comunicado eliminado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Tareas y obligaciones con fecha de vencimiento en los próximos días */
export function useUpcomingDeadlines(daysAhead = 30) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["upcoming-deadlines", daysAhead],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setDate(end.getDate() + daysAhead);
      const endIso = end.toISOString().split("T")[0];
      const todayIso = today.toISOString().split("T")[0];

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) return { tasks: [], steps: [] };

      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("id, title, due_date, status, priority, client_id, project_id, clients(name), projects(name)")
        .eq("organization_id", profile.organization_id)
        .not("due_date", "is", null)
        .gte("due_date", todayIso)
        .lte("due_date", endIso)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true });
      if (tasksError) throw tasksError;

      const { data: periods } = await supabase
        .from("accounting_periods")
        .select("id, project_id, year, month, steps, projects(name)")
        .eq("organization_id", profile.organization_id);
      if (!periods) return { tasks: tasks ?? [], steps: [] };

      const stepsWithDue: Array<{
        id: string;
        type: "accounting_step";
        label: string;
        due_date: string;
        project_name: string;
        client_name?: string;
        period_label: string;
      }> = [];
      periods.forEach((p: any) => {
        const steps = (p.steps as any[]) ?? [];
        const projectName = p.projects?.name ?? "—";
        const periodLabel = `${p.year}-${String(p.month).padStart(2, "0")}`;
        steps.forEach((s: any) => {
          const due = s.due_date ?? s.fecha_limite;
          if (!due) return;
          const d = typeof due === "string" ? due.split("T")[0] : due;
          if (d >= todayIso && d <= endIso) {
            stepsWithDue.push({
              id: `${p.id}-${s.key ?? s.id ?? Math.random()}`,
              type: "accounting_step",
              label: s.label ?? s.key ?? "Paso",
              due_date: d,
              project_name: projectName,
              period_label: periodLabel,
            });
          }
        });
      });
      stepsWithDue.sort((a, b) => a.due_date.localeCompare(b.due_date));

      return {
        tasks: (tasks ?? []).map((t: any) => ({
          id: t.id,
          type: "task",
          title: t.title,
          due_date: t.due_date,
          status: t.status,
          priority: t.priority,
          client_name: t.clients?.name,
          project_name: t.projects?.name,
        })),
        steps: stepsWithDue,
      };
    },
    enabled: !!user,
  });
}
