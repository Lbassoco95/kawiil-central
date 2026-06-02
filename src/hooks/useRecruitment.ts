import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { useUserRole } from "@/hooks/useUserRole";
import {
  DEFAULT_STAGES,
  type Candidate,
  type CandidateActivity,
  type RecruitmentProcess,
  type RecruitmentStage,
  type RhCandidateActivityType,
  type RhCandidateStatus,
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

/** ¿El usuario actual puede gestionar reclutamiento? (permiso o G4) */
export function useIsRecruiter(): boolean {
  const { hasModule } = useModulePermissions();
  const { isTransformador } = useUserRole();
  return isTransformador || hasModule("reclutamiento");
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
    mutationFn: async (input: { title: string; area?: string | null; description?: string | null; celula_id?: string | null }) => {
      const orgId = await getMyOrgId(user!.id);
      const { data, error } = await db
        .from("rh_recruitment_processes")
        .insert({
          organization_id: orgId,
          title: input.title,
          area: input.area ?? null,
          description: input.description ?? null,
          celula_id: input.celula_id ?? null,
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

export function useCreateCandidate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      process_id: string;
      stage_id: string | null;
      full_name: string;
      email?: string | null;
      phone?: string | null;
      source?: string | null;
    }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_candidates").insert({
        organization_id: orgId,
        process_id: input.process_id,
        stage_id: input.stage_id,
        full_name: input.full_name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source ?? null,
        created_by: user!.id,
      });
      if (error) throw error;
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

export function useSetCandidateStatus() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidate, status }: { candidate: Candidate; status: RhCandidateStatus }) => {
      const { error } = await db.from("rh_candidates").update({ status }).eq("id", candidate.id);
      if (error) throw error;
      const labels: Record<RhCandidateStatus, string> = {
        active: "En proceso",
        hired: "Contratado",
        rejected: "Descartado",
        withdrawn: "Declinó",
      };
      await logActivity(candidate.organization_id, user!.id, candidate.id, "status_change", labels[status]);
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
