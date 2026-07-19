import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { useUserRole } from "@/hooks/useUserRole";
import {
  DEFAULT_CRITERIA,
  DEFAULT_STAGES,
  DEFAULT_STATES,
  type Candidate,
  type CandidateActivity,
  type CandidateAiAnalysis,
  type CandidateAttachment,
  type CandidateScore,
  type EmailTemplate,
  type RecruitmentCriterion,
  type RecruitmentProcess,
  type RecruitmentStage,
  type RecruitmentState,
  type RhCandidateActivityType,
  type RhProcessStatus,
} from "@/lib/recruitment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function getMyOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.organization_id) throw new Error("No se pudo determinar tu organización.");
  return data.organization_id as string;
}

/** ¿El usuario actual es Admin de reclutamiento? (permiso de módulo o G4) */
export function useIsRecruiter(): boolean {
  const { hasModule } = useModulePermissions();
  const { isTransformador } = useUserRole();
  return isTransformador || hasModule("reclutamiento");
}

/** ¿El usuario actual está asignado como entrevistador en alguna vacante? */
export function useIsAnyInterviewer(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["rh-is-interviewer", user?.id],
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await db
        .from("rh_process_interviewers")
        .select("process_id", { count: "exact", head: true })
        .eq("user_id", user!.id);
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
  return !!data;
}

/** Acceso al módulo de reclutamiento: Admin o entrevistador asignado. */
export function useCanAccessRecruitment(): boolean {
  const isRecruiter = useIsRecruiter();
  const isInterviewer = useIsAnyInterviewer();
  const isOwner = useIsAnyOwner();
  return isRecruiter || isInterviewer || isOwner;
}

/** ¿El usuario actual es responsable de alguna vacante? */
export function useIsAnyOwner(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["rh-is-owner", user?.id],
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await db
        .from("rh_process_owners")
        .select("process_id", { count: "exact", head: true })
        .eq("user_id", user!.id);
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
  return !!data;
}

/** ¿El usuario actual es responsable de ESTA vacante? (gestión acotada) */
export function useIsProcessOwner(processId: string | null): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["rh-is-owner-of", processId, user?.id],
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await db
        .from("rh_process_owners")
        .select("process_id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("process_id", processId);
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!user && !!processId,
    staleTime: 60 * 1000,
  });
  return !!data;
}

/* ---------------- Responsables por vacante ---------------- */
export function useProcessOwners(processId: string | null) {
  return useQuery({
    queryKey: ["rh-owners", processId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db
        .from("rh_process_owners")
        .select("user_id")
        .eq("process_id", processId);
      if (error) throw error;
      return ((data as { user_id: string }[]) ?? []).map((r) => r.user_id);
    },
    enabled: !!processId,
  });
}

export function useAddOwner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, userId }: { processId: string; userId: string }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_process_owners").insert({
        organization_id: orgId, process_id: processId, user_id: userId, created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-owners", vars.processId] });
      toast.success("Responsable asignado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo asignar"),
  });
}

export function useRemoveOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, userId }: { processId: string; userId: string }) => {
      const { error } = await db.from("rh_process_owners").delete().eq("process_id", processId).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-owners", vars.processId] });
      toast.success("Responsable quitado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo quitar"),
  });
}

/* ---------------- Entrevistadores por vacante ---------------- */
export function useProcessInterviewers(processId: string | null) {
  return useQuery({
    queryKey: ["rh-interviewers", processId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db
        .from("rh_process_interviewers")
        .select("user_id")
        .eq("process_id", processId);
      if (error) throw error;
      return ((data as { user_id: string }[]) ?? []).map((r) => r.user_id);
    },
    enabled: !!processId,
  });
}

export function useAddInterviewer() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, userId }: { processId: string; userId: string }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_process_interviewers").insert({
        organization_id: orgId,
        process_id: processId,
        user_id: userId,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-interviewers", vars.processId] });
      toast.success("Entrevistador asignado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo asignar"),
  });
}

export function useRemoveInterviewer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, userId }: { processId: string; userId: string }) => {
      const { error } = await db
        .from("rh_process_interviewers")
        .delete()
        .eq("process_id", processId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-interviewers", vars.processId] });
      toast.success("Entrevistador quitado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo quitar"),
  });
}

export function useRecruitmentProcesses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-processes"],
    queryFn: async (): Promise<RecruitmentProcess[]> => {
      const { data, error } = await db
        .from("rh_recruitment_processes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as RecruitmentProcess[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateProcess() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; celula_id: string; description?: string | null; grade?: string | null; budget?: number | null; location?: string | null }) => {
      const orgId = await getMyOrgId(user!.id);
      const { data, error } = await db
        .from("rh_recruitment_processes")
        .insert({
          organization_id: orgId,
          title: input.title,
          description: input.description ?? null,
          celula_id: input.celula_id,
          grade: input.grade ?? null,
          budget: input.budget ?? null,
          location: input.location ?? null,
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const processId = data.id as string;
      // Sembrar fases por defecto.
      const stages = DEFAULT_STAGES.map((name, i) => ({
        organization_id: orgId,
        process_id: processId,
        name,
        position: i,
      }));
      const { error: se } = await db.from("rh_recruitment_stages").insert(stages);
      if (se) throw se;
      // Sembrar estados por defecto.
      const states = DEFAULT_STATES.map((s, i) => ({
        organization_id: orgId,
        process_id: processId,
        name: s.name,
        color: s.color,
        position: i,
        is_default: i === 0,
      }));
      const { error: ste } = await db.from("rh_recruitment_states").insert(states);
      if (ste) throw ste;
      // Sembrar criterios de la rúbrica por defecto.
      const criteria = DEFAULT_CRITERIA.map((c, i) => ({
        organization_id: orgId,
        process_id: processId,
        name: c.name,
        weight: c.weight,
        position: i,
      }));
      const { error: ce } = await db.from("rh_recruitment_criteria").insert(criteria);
      if (ce) throw ce;
      return processId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-processes"] });
      toast.success("Vacante creada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo crear la vacante"),
  });
}

export function useUpdateProcessStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RhProcessStatus }) => {
      const { error } = await db.from("rh_recruitment_processes").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-processes"] });
      toast.success("Vacante actualizada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

export function useProcessStages(processId: string | null) {
  return useQuery({
    queryKey: ["rh-stages", processId],
    queryFn: async (): Promise<RecruitmentStage[]> => {
      const { data, error } = await db
        .from("rh_recruitment_stages")
        .select("*")
        .eq("process_id", processId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as RecruitmentStage[]) ?? [];
    },
    enabled: !!processId,
  });
}

/* ---------------- Gestión de fases (columnas del Kanban) ---------------- */
export function useCreateStage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, name, position }: { processId: string; name: string; position: number }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_recruitment_stages").insert({
        organization_id: orgId,
        process_id: processId,
        name,
        position,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-stages", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo crear la fase"),
  });
}

export function useRenameStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string; processId: string }) => {
      const { error } = await db.from("rh_recruitment_stages").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-stages", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo renombrar la fase"),
  });
}

export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; processId: string }) => {
      const { error } = await db.from("rh_recruitment_stages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-stages", vars.processId] });
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.processId] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar la fase"),
  });
}

/** Reordena las fases guardando su nueva posición. */
export function useReorderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ordered }: { processId: string; ordered: RecruitmentStage[] }) => {
      await Promise.all(
        ordered.map((s, i) =>
          db.from("rh_recruitment_stages").update({ position: i }).eq("id", s.id),
        ),
      );
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-stages", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo reordenar"),
  });
}

/* ---------------- Estados personalizados ---------------- */
export function useProcessStates(processId: string | null) {
  return useQuery({
    queryKey: ["rh-states", processId],
    queryFn: async (): Promise<RecruitmentState[]> => {
      const { data, error } = await db
        .from("rh_recruitment_states")
        .select("*")
        .eq("process_id", processId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as RecruitmentState[]) ?? [];
    },
    enabled: !!processId,
  });
}

export function useCreateState() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, name, color, position }: { processId: string; name: string; color: string; position: number }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_recruitment_states").insert({
        organization_id: orgId,
        process_id: processId,
        name,
        color,
        position,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-states", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo crear el estado"),
  });
}

export function useUpdateState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name?: string; color?: string; processId: string }) => {
      const patch: Record<string, string> = {};
      if (name !== undefined) patch.name = name;
      if (color !== undefined) patch.color = color;
      const { error } = await db.from("rh_recruitment_states").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-states", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el estado"),
  });
}

export function useDeleteState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; processId: string }) => {
      const { error } = await db.from("rh_recruitment_states").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-states", vars.processId] });
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.processId] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar el estado"),
  });
}

/* ---------------- Rúbrica: criterios ---------------- */
export function useProcessCriteria(processId: string | null) {
  return useQuery({
    queryKey: ["rh-criteria", processId],
    queryFn: async (): Promise<RecruitmentCriterion[]> => {
      const { data, error } = await db
        .from("rh_recruitment_criteria")
        .select("*")
        .eq("process_id", processId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as RecruitmentCriterion[]) ?? [];
    },
    enabled: !!processId,
  });
}

export function useCreateCriterion() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ processId, name, weight, position }: { processId: string; name: string; weight: number; position: number }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_recruitment_criteria").insert({
        organization_id: orgId,
        process_id: processId,
        name,
        weight,
        position,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-criteria", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo crear el criterio"),
  });
}

export function useUpdateCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, weight }: { id: string; name?: string; weight?: number; processId: string }) => {
      const patch: Record<string, string | number> = {};
      if (name !== undefined) patch.name = name;
      if (weight !== undefined) patch.weight = weight;
      const { error } = await db.from("rh_recruitment_criteria").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-criteria", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el criterio"),
  });
}

export function useDeleteCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; processId: string }) => {
      const { error } = await db.from("rh_recruitment_criteria").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-criteria", vars.processId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar el criterio"),
  });
}

/* ---------------- Rúbrica: calificaciones ---------------- */
export function useCandidateScores(candidateId: string | null) {
  return useQuery({
    queryKey: ["rh-scores", candidateId],
    queryFn: async (): Promise<CandidateScore[]> => {
      const { data, error } = await db
        .from("rh_candidate_scores")
        .select("*")
        .eq("candidate_id", candidateId);
      if (error) throw error;
      return (data as CandidateScore[]) ?? [];
    },
    enabled: !!candidateId,
  });
}

/** Registra/actualiza la calificación de un criterio y recalcula el rating global. */
export function useSetCandidateScore() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidate,
      criterionId,
      score,
    }: {
      candidate: Candidate;
      criterionId: string;
      score: number;
    }) => {
      // El rating ponderado se recalcula en la BD mediante trigger.
      const { error } = await db
        .from("rh_candidate_scores")
        .upsert(
          {
            organization_id: candidate.organization_id,
            candidate_id: candidate.id,
            criterion_id: criterionId,
            score,
            scored_by: user!.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "candidate_id,criterion_id" },
        );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-scores", vars.candidate.id] });
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar la calificación"),
  });
}

/* ---------------- Ficha del candidato ---------------- */
export function useUpdateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, patch }: { candidate: Candidate; patch: Partial<Candidate> }) => {
      const { error } = await db
        .from("rh_candidates")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", candidate.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      toast.success("Ficha actualizada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar la ficha"),
  });
}

export function useCandidates(processId: string | null) {
  return useQuery({
    queryKey: ["rh-candidates", processId],
    queryFn: async (): Promise<Candidate[]> => {
      const { data, error } = await db
        .from("rh_candidates")
        .select("*")
        .eq("process_id", processId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Candidate[]) ?? [];
    },
    enabled: !!processId,
  });
}

/** Fecha del último contacto/movimiento por candidato (para el pipeline). */
export function useLastContacts(candidateIds: string[]) {
  const key = candidateIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["rh-last-contacts", key],
    queryFn: async (): Promise<Record<string, string>> => {
      if (candidateIds.length === 0) return {};
      const { data, error } = await db
        .from("rh_candidate_activities")
        .select("candidate_id, created_at")
        .in("candidate_id", candidateIds);
      if (error) throw error;
      const m: Record<string, string> = {};
      for (const a of (data as { candidate_id: string; created_at: string }[]) ?? []) {
        if (!m[a.candidate_id] || a.created_at > m[a.candidate_id]) m[a.candidate_id] = a.created_at;
      }
      return m;
    },
    enabled: candidateIds.length > 0,
  });
}

/* ---------------- Panel CHRO: vistas org-wide (reclutador/G4) ---------------- */
export function useAllCandidates(enabled: boolean) {
  return useQuery({
    queryKey: ["rh-all-candidates"],
    queryFn: async (): Promise<Candidate[]> => {
      const { data, error } = await db.from("rh_candidates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Candidate[]) ?? [];
    },
    enabled,
  });
}

export function useAllCandidateActivities(enabled: boolean) {
  return useQuery({
    queryKey: ["rh-all-candidate-activities"],
    queryFn: async (): Promise<{ candidate_id: string; activity_type: string; created_at: string }[]> => {
      const { data, error } = await db.from("rh_candidate_activities").select("candidate_id, activity_type, created_at");
      if (error) throw error;
      return (data as { candidate_id: string; activity_type: string; created_at: string }[]) ?? [];
    },
    enabled,
  });
}

export function useCreateCandidate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      process_id: string;
      stage_id: string | null;
      state_id: string | null;
      full_name: string;
      email?: string | null;
      phone?: string | null;
      source?: string | null;
    }): Promise<string> => {
      const orgId = await getMyOrgId(user!.id);
      const { data, error } = await db
        .from("rh_candidates")
        .insert({
          organization_id: orgId,
          process_id: input.process_id,
          stage_id: input.stage_id,
          state_id: input.state_id,
          full_name: input.full_name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          source: input.source ?? null,
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.process_id] });
      toast.success("Candidato agregado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar el candidato"),
  });
}

async function logActivity(
  orgId: string,
  userId: string,
  candidateId: string,
  activity_type: RhCandidateActivityType,
  content: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> = {},
) {
  await db.from("rh_candidate_activities").insert({
    organization_id: orgId,
    candidate_id: candidateId,
    activity_type,
    content,
    metadata,
    created_by: userId,
  });
}

export function useDeleteCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate }: { candidate: Candidate }) => {
      const { error } = await db.from("rh_candidates").delete().eq("id", candidate.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      toast.success("Candidato eliminado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar el candidato"),
  });
}

export function useMoveCandidateStage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidate,
      stageId,
      stageName,
    }: {
      candidate: Candidate;
      stageId: string;
      stageName: string;
    }) => {
      const { error } = await db.from("rh_candidates").update({ stage_id: stageId }).eq("id", candidate.id);
      if (error) throw error;
      await logActivity(candidate.organization_id, user!.id, candidate.id, "stage_change", `Movido a "${stageName}"`);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo mover el candidato"),
  });
}

export function useSetCandidateState() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, stateId, stateName }: { candidate: Candidate; stateId: string; stateName: string }) => {
      // Sincroniza el status real del candidato con el estado elegido para que la ficha lo refleje.
      const patch: Record<string, unknown> = { state_id: stateId };
      const n = stateName.toLowerCase();
      if (n.includes("contratad")) patch.status = "hired";
      else if (n.includes("descartad") || n.includes("rechazad")) patch.status = "rejected";
      else if (n.includes("declin")) patch.status = "withdrawn";
      else patch.status = "active";
      const { error } = await db.from("rh_candidates").update(patch).eq("id", candidate.id);
      if (error) throw error;
      await logActivity(candidate.organization_id, user!.id, candidate.id, "status_change", stateName);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("Estado actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el estado"),
  });
}

export function useCandidateActivities(candidateId: string | null) {
  return useQuery({
    queryKey: ["rh-candidate-activities", candidateId],
    queryFn: async (): Promise<CandidateActivity[]> => {
      const { data, error } = await db
        .from("rh_candidate_activities")
        .select("*")
        .eq("candidate_id", candidateId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CandidateActivity[]) ?? [];
    },
    enabled: !!candidateId,
  });
}

export function useAddCandidateNote() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, note }: { candidate: Candidate; note: string }) => {
      const orgId = await getMyOrgId(user!.id);
      await logActivity(orgId, user!.id, candidate.id, "note", note);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("Nota agregada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar la nota"),
  });
}

/** Registra en la bitácora que se envió un correo (el envío real lo hace useSendNewEmail). */
export function useLogCandidateEmail() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, subject }: { candidate: Candidate; subject: string }) => {
      const orgId = await getMyOrgId(user!.id);
      await logActivity(orgId, user!.id, candidate.id, "email", `Correo enviado: ${subject}`, { subject });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
    },
  });
}

/**
 * Envía un correo al candidato desde el remitente corporativo (rh@kawiil.mx)
 * vía la edge function `send-candidate-email`. El backend sustituye variables,
 * envía con Resend y registra el envío en la bitácora SOLO si fue exitoso.
 */
export function useSendCandidateEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidate,
      subject,
      body,
    }: {
      candidate: Candidate;
      subject: string;
      body: string;
    }) => {
      const { data, error } = await supabase.functions.invoke<{
        message_id: string;
        comunicacion_id: string | null;
        error?: string;
      }>("send-candidate-email", {
        body: { candidate_id: candidate.id, subject, body },
      });
      // Las funciones devuelven el error en el cuerpo con status !=2xx.
      const fnError = error
        ? (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error
        : data?.error;
      if (error || fnError) throw new Error(fnError || error?.message || "No se pudo enviar el correo.");
      return data!;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("Correo enviado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar el correo."),
  });
}

/* ---------------- Importación masiva de candidatos (CSV/Excel) ---------------- */
export type ImportCandidateRow = Partial<
  Pick<
    Candidate,
    | "full_name" | "email" | "phone" | "source"
    | "university" | "degree" | "education_status" | "skills"
    | "years_experience" | "salary_expectation" | "available_from"
    | "linkedin_url" | "portfolio_url"
  >
>;

export function useImportCandidates() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      processId,
      stageId,
      stateId,
      rows,
    }: {
      processId: string;
      stageId: string | null;
      stateId: string | null;
      rows: ImportCandidateRow[];
    }): Promise<number> => {
      const orgId = await getMyOrgId(user!.id);
      const payload = rows
        .filter((r) => (r.full_name ?? "").trim().length > 0)
        .map((r) => ({
          organization_id: orgId,
          process_id: processId,
          stage_id: stageId,
          state_id: stateId,
          created_by: user!.id,
          full_name: r.full_name!.trim(),
          email: r.email ?? null,
          phone: r.phone ?? null,
          source: r.source ?? null,
          university: r.university ?? null,
          degree: r.degree ?? null,
          education_status: r.education_status ?? null,
          skills: r.skills ?? [],
          years_experience: r.years_experience ?? null,
          salary_expectation: r.salary_expectation ?? null,
          available_from: r.available_from ?? null,
          linkedin_url: r.linkedin_url ?? null,
          portfolio_url: r.portfolio_url ?? null,
        }));
      if (payload.length === 0) throw new Error("No hay filas con nombre para importar.");
      const { error } = await db.from("rh_candidates").insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (count, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.processId] });
      toast.success(`${count} candidato(s) importado(s)`);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo importar"),
  });
}

/* ---------------- Nombre de la organización (para variables) ---------------- */
export function useOrgName() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["org-name"],
    queryFn: async (): Promise<string> => {
      const orgId = await getMyOrgId(user!.id);
      const { data } = await db.from("organizations").select("name").eq("id", orgId).single();
      return (data?.name as string) ?? "";
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/* ---------------- Plantillas de email ---------------- */
export function useEmailTemplates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-email-templates"],
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await db
        .from("rh_email_templates")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data as EmailTemplate[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateEmailTemplate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; subject: string; body: string }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_email_templates").insert({
        organization_id: orgId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-email-templates"] });
      toast.success("Plantilla creada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo crear la plantilla"),
  });
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, subject, body }: { id: string; name: string; subject: string; body: string }) => {
      const { error } = await db
        .from("rh_email_templates")
        .update({ name, subject, body, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-email-templates"] });
      toast.success("Plantilla actualizada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar la plantilla"),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await db.from("rh_email_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-email-templates"] });
      toast.success("Plantilla eliminada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar la plantilla"),
  });
}

const CV_BUCKET = "cv";

/** Sube (o reemplaza) el CV del candidato al bucket privado y guarda su ruta. */
export function useUploadCandidateCv() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, file }: { candidate: Candidate; file: File }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${candidate.organization_id}/${candidate.id}/cv_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(CV_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await db.from("rh_candidates").update({ resume_url: path }).eq("id", candidate.id);
      if (error) throw error;
      await logActivity(candidate.organization_id, user!.id, candidate.id, "note", `CV cargado: ${file.name}`);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("CV cargado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cargar el CV"),
  });
}

/** Sube el PDF del examen/psicométrico del candidato (bucket privado 'cv'). */
export function useUploadCandidateExam() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, file }: { candidate: Candidate; file: File }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${candidate.organization_id}/${candidate.id}/examen_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(CV_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await db.from("rh_candidates").update({ assessment_file_path: path }).eq("id", candidate.id);
      if (error) throw error;
      await logActivity(candidate.organization_id, user!.id, candidate.id, "note", `Examen cargado: ${file.name}`);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("Examen cargado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cargar el examen"),
  });
}

/* ---------------- Adjuntos múltiples del candidato ---------------- */

/** Lista los archivos adjuntos del candidato (más recientes primero). */
export function useCandidateAttachments(candidateId: string | null) {
  return useQuery({
    queryKey: ["rh-candidate-attachments", candidateId],
    enabled: !!candidateId,
    queryFn: async (): Promise<CandidateAttachment[]> => {
      const { data, error } = await db
        .from("rh_candidate_attachments")
        .select("*")
        .eq("candidate_id", candidateId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CandidateAttachment[]) ?? [];
    },
  });
}

/** Sube un adjunto del candidato al bucket privado 'cv' y lo registra con un nombre/comentario. */
export function useUploadCandidateAttachment() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, file, label }: { candidate: Candidate; file: File; label: string }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${candidate.organization_id}/${candidate.id}/adjunto_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(CV_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await db.from("rh_candidate_attachments").insert({
        organization_id: candidate.organization_id,
        candidate_id: candidate.id,
        file_path: path,
        file_name: file.name,
        label: label.trim() || null,
        content_type: file.type || null,
        size_bytes: file.size,
        created_by: user!.id,
      });
      if (error) throw error;
      await logActivity(candidate.organization_id, user!.id, candidate.id, "note",
        `Adjunto cargado: ${label.trim() || file.name}`);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidate-attachments", vars.candidate.id] });
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("Adjunto cargado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cargar el adjunto"),
  });
}

/** Renombra (actualiza el comentario de) un adjunto. */
export function useUpdateCandidateAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ attachment, label }: { attachment: CandidateAttachment; label: string }) => {
      const { error } = await db
        .from("rh_candidate_attachments")
        .update({ label: label.trim() || null })
        .eq("id", attachment.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidate-attachments", vars.attachment.candidate_id] });
      toast.success("Adjunto actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el adjunto"),
  });
}

/** Elimina un adjunto (registro + archivo en storage). */
export function useDeleteCandidateAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ attachment }: { attachment: CandidateAttachment }) => {
      const { error } = await db.from("rh_candidate_attachments").delete().eq("id", attachment.id);
      if (error) throw error;
      // Best-effort: borra el archivo del bucket (si falla, el registro ya no existe).
      await supabase.storage.from(CV_BUCKET).remove([attachment.file_path]);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidate-attachments", vars.attachment.candidate_id] });
      toast.success("Adjunto eliminado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar el adjunto"),
  });
}

/** Sube el CV de un candidato recién creado (cuando ya tenemos su id). */
export async function uploadCandidateCvByIds(orgId: string, candidateId: string, file: File): Promise<void> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const path = `${orgId}/${candidateId}/cv_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(CV_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { error } = await db.from("rh_candidates").update({ resume_url: path }).eq("id", candidateId);
  if (error) throw error;
}

/** Lanza el análisis de "Fit Kawiil" con IA sobre el examen del candidato. */
export function useAnalyzeCandidateFit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate }: { candidate: Candidate }) => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        analysis?: CandidateAiAnalysis;
        error?: string;
      }>("analyze-candidate-fit", { body: { candidate_id: candidate.id } });
      if (error) throw new Error(error.message || "No se pudo analizar el examen");
      if (data?.error) throw new Error(data.error);
      return data?.analysis ?? null;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      qc.invalidateQueries({ queryKey: ["rh-candidate-activities", vars.candidate.id] });
      toast.success("Análisis de IA completado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo analizar el examen"),
  });
}

export interface ExtractedCvData {
  university: string | null;
  degree: string | null;
  education_status: string | null;
  years_experience: number | null;
  salary_expectation: number | null;
  available_from: string | null;
  skills: string[];
  linkedin_url: string | null;
  portfolio_url: string | null;
  phone: string | null;
  email: string | null;
}

/** Extrae datos del CV con IA para prellenar la ficha (no escribe en la base). */
export function useExtractCvData() {
  return useMutation({
    mutationFn: async ({ candidate }: { candidate: Candidate }): Promise<ExtractedCvData> => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; data?: ExtractedCvData; error?: string }>(
        "extract-cv-data",
        { body: { candidate_id: candidate.id } },
      );
      if (error) throw new Error(error.message || "No se pudo leer el CV");
      if (data?.error) throw new Error(data.error);
      if (!data?.data) throw new Error("El CV no devolvió datos.");
      return data.data;
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo prellenar desde el CV"),
  });
}

/** Lee el perfil cultural de Kawiil guardado en organizations.settings. */
export function useOrgCulturalProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-cultural-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const orgId = await getMyOrgId(user!.id);
      const { data, error } = await db
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw error;
      const settings = (data?.settings ?? {}) as Record<string, unknown>;
      return typeof settings.rh_cultural_profile === "string" ? settings.rh_cultural_profile : "";
    },
  });
}

/** Guarda el perfil cultural de Kawiil (fusionado en organizations.settings). */
export function useSetOrgCulturalProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      const orgId = await getMyOrgId(user!.id);
      const { data: row } = await db
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .maybeSingle();
      const settings = { ...((row?.settings ?? {}) as Record<string, unknown>), rh_cultural_profile: text };
      const { error } = await db.from("organizations").update({ settings }).eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-cultural-profile"] });
      toast.success("Perfil de Kawiil guardado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar el perfil"),
  });
}

/** Genera una URL firmada temporal para ver/descargar el CV. */
export async function getCvSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(CV_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export { CV_BUCKET };
