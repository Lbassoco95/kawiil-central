import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { OnboardingItem, OnboardingTemplateItem } from "@/lib/onboarding";

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

/* ---------------- Plantilla de bienvenida ---------------- */
export function useOnboardingTemplate() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-onboarding-template"],
    queryFn: async (): Promise<OnboardingTemplateItem[]> => {
      const { data, error } = await db
        .from("rh_onboarding_template_items")
        .select("*")
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as OnboardingTemplateItem[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateTemplateItem() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ label, position }: { label: string; position: number }) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_onboarding_template_items").insert({
        organization_id: orgId,
        label,
        position,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-onboarding-template"] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar"),
  });
}

export function useUpdateTemplateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const { error } = await db.from("rh_onboarding_template_items").update({ label }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-onboarding-template"] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

export function useDeleteTemplateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("rh_onboarding_template_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-onboarding-template"] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
  });
}

/* ---------------- Checklist por colaborador ---------------- */
export function useOnboardingItems(userId: string | null) {
  return useQuery({
    queryKey: ["rh-onboarding-items", userId],
    queryFn: async (): Promise<OnboardingItem[]> => {
      const { data, error } = await db
        .from("rh_onboarding_items")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as OnboardingItem[]) ?? [];
    },
    enabled: !!userId,
  });
}

export function useToggleOnboardingItem() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, done }: { item: OnboardingItem; done: boolean }) => {
      const { error } = await db
        .from("rh_onboarding_items")
        .update({ done, done_by: done ? user!.id : null, done_at: done ? new Date().toISOString() : null })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-onboarding-items", vars.item.user_id] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

/** Crea el checklist de un colaborador a partir de la plantilla de la org. */
async function seedOnboardingForUser(orgId: string, userId: string) {
  const { data: tpl } = await db
    .from("rh_onboarding_template_items")
    .select("*")
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  const items = ((tpl as OnboardingTemplateItem[]) ?? []).map((t) => ({
    organization_id: orgId,
    user_id: userId,
    label: t.label,
    position: t.position,
  }));
  if (items.length > 0) {
    await db.from("rh_onboarding_items").insert(items);
  }
}

/** Inicia (o reinicia si no existe) la bienvenida de un colaborador ya existente. */
export function useStartOnboarding() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const orgId = await getMyOrgId(user!.id);
      const { count } = await db
        .from("rh_onboarding_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if ((count ?? 0) > 0) return;
      await seedOnboardingForUser(orgId, userId);
    },
    onSuccess: (_, userId) => qc.invalidateQueries({ queryKey: ["rh-onboarding-items", userId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo iniciar la bienvenida"),
  });
}

/** Todos los checklists de la org (G4) para el tablero. */
export function useOnboardingOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["rh-onboarding-overview"],
    queryFn: async (): Promise<OnboardingItem[]> => {
      const { data, error } = await db.from("rh_onboarding_items").select("*");
      if (error) throw error;
      return (data as OnboardingItem[]) ?? [];
    },
    enabled,
  });
}

/* ---------------- Conversión candidato → colaborador ---------------- */
export function useConvertCandidate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidate,
      role,
      celulaId,
      contratadoStateId,
    }: {
      candidate: { id: string; process_id: string; full_name: string; email: string | null; phone: string | null };
      role: string;
      celulaId?: string | null;
      contratadoStateId?: string | null;
    }) => {
      if (!candidate.email) throw new Error("El candidato no tiene correo; agrégalo antes de convertirlo.");
      const orgId = await getMyOrgId(user!.id);

      // 1) Invitar/crear la cuenta del colaborador (envía correo de acceso) y vincular célula.
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: {
          email: candidate.email,
          full_name: candidate.full_name,
          role,
          phone: candidate.phone ?? undefined,
          celula_id: celulaId ?? undefined,
        },
      });
      if (error) throw new Error(error.message || "No se pudo invitar al colaborador.");
      const newUserId = (data as { user_id?: string })?.user_id;

      // 2) Sembrar el checklist de bienvenida.
      if (newUserId) await seedOnboardingForUser(orgId, newUserId);

      // 3) Marcar al candidato como contratado, vincularlo y fijar el estado "Contratado".
      const patch: Record<string, unknown> = { status: "hired", hired_user_id: newUserId ?? null };
      if (contratadoStateId) patch.state_id = contratadoStateId;
      await db.from("rh_candidates").update(patch).eq("id", candidate.id);

      // 4) Marcar la vacante como cubierta.
      await db.from("rh_recruitment_processes").update({ status: "filled" }).eq("id", candidate.process_id);

      return newUserId;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-candidates", vars.candidate.process_id] });
      qc.invalidateQueries({ queryKey: ["rh-processes"] });
      qc.invalidateQueries({ queryKey: ["org-users"] });
      toast.success("Colaborador creado. Se envió el correo de acceso, se inició su bienvenida y la vacante quedó cubierta.");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo convertir el candidato"),
  });
}
