import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface Expense {
  id: string;
  organization_id: string;
  requested_by: string;
  category: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  client_id: string | null;
  project_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  receipt_path: string | null;
  notes: string | null;
  expense_date: string;
  created_at: string;
  updated_at: string;
}

export function useExpenses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
    enabled: !!user,
  });
}

export interface CreateExpenseParams {
  category: string;
  amount: number;
  currency: string;
  description: string;
  client_id?: string | null;
  project_id?: string | null;
  expense_date: string;
  receipt_path?: string | null;
  notes?: string | null;
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateExpenseParams) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile) throw new Error("Perfil no encontrado");

      const { data, error } = await supabase
        .from("expenses")
        .insert({
          ...params,
          organization_id: profile.organization_id,
          requested_by: user!.id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Solicitud de gasto creada");
    },
    onError: (e: any) => toast.error(e.message || "Error al crear solicitud"),
  });
}

export function useUpdateExpenseStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      rejection_reason,
    }: {
      id: string;
      status: string;
      rejection_reason?: string;
    }) => {
      const now = new Date().toISOString();
      const updates: Record<string, any> = { status };

      if (status === "en_revision") {
        updates.reviewed_by = user!.id;
        updates.reviewed_at = now;
      } else if (status === "aprobado") {
        updates.approved_by = user!.id;
        updates.approved_at = now;
      } else if (status === "rechazado") {
        updates.approved_by = user!.id;
        updates.approved_at = now;
        updates.rejection_reason = rejection_reason || null;
      } else if (status === "pagado") {
        updates.paid_by = user!.id;
        updates.paid_at = now;
      }

      const { error } = await supabase
        .from("expenses")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Estado actualizado");
    },
    onError: (e: any) => toast.error(e.message || "Error al actualizar"),
  });
}
