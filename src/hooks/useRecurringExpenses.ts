import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { ReimbursementType } from "@/hooks/useExpenses";

export type RecurringFrequency =
  | "semanal"
  | "quincenal"
  | "mensual"
  | "bimestral"
  | "trimestral"
  | "semestral"
  | "anual";

/** Cuántas veces al año se paga cada frecuencia (para anualizar/normalizar a mes). */
export const FREQUENCY_PER_YEAR: Record<RecurringFrequency, number> = {
  semanal: 52,
  quincenal: 24,
  mensual: 12,
  bimestral: 6,
  trimestral: 4,
  semestral: 2,
  anual: 1,
};

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

export type RecurringChargeTo = "kawiil" | "cliente" | "reembolsar_trabajador" | "empresa_grupo";

export interface RecurringExpense {
  id: string;
  organization_id: string;
  name: string;
  category: string;
  amount: number;
  currency: string;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  vendor: string | null;
  charge_to: RecurringChargeTo;
  client_id: string | null;
  project_id: string | null;
  group_company_id: string | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringExpenseInput {
  name: string;
  category: string;
  amount: number;
  currency: string;
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  vendor?: string | null;
  charge_to: RecurringChargeTo;
  client_id?: string | null;
  project_id?: string | null;
  group_company_id?: string | null;
  start_date: string;
  end_date?: string | null;
  active?: boolean;
  notes?: string | null;
}

/** Monto mensual equivalente de un gasto recurrente (para el dashboard de planeación). */
export function monthlyEquivalent(r: Pick<RecurringExpense, "amount" | "frequency">): number {
  const perYear = FREQUENCY_PER_YEAR[r.frequency] ?? 12;
  return (Number(r.amount) * perYear) / 12;
}

/** Traduce charge_to del recurrente al tipo de reembolso del gasto real. */
export function chargeToReimbursement(charge_to: RecurringChargeTo): ReimbursementType | null {
  switch (charge_to) {
    case "cliente":
      return "cobrar_cliente";
    case "empresa_grupo":
      return "cobrar_empresa_grupo";
    case "reembolsar_trabajador":
      return "reembolsar_trabajador";
    default:
      return null;
  }
}

export function useRecurringExpenses(includeInactive = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["recurring-expenses", includeInactive],
    queryFn: async (): Promise<RecurringExpense[]> => {
      let q = (supabase as any)
        .from("recurring_expenses")
        .select("*")
        .order("name", { ascending: true });
      if (!includeInactive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RecurringExpense[];
    },
    enabled: !!user,
  });
}

async function currentOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  if (error || !data?.organization_id) throw new Error("No se encontró la organización del usuario");
  return data.organization_id as string;
}

export function useCreateRecurringExpense() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: RecurringExpenseInput) => {
      const organization_id = await currentOrgId(user!.id);
      const { data, error } = await (supabase as any)
        .from("recurring_expenses")
        .insert({
          organization_id,
          name: input.name.trim(),
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          frequency: input.frequency,
          day_of_month: input.day_of_month ?? null,
          vendor: input.vendor?.trim() || null,
          charge_to: input.charge_to,
          client_id: input.client_id || null,
          project_id: input.project_id || null,
          group_company_id: input.group_company_id || null,
          start_date: input.start_date,
          end_date: input.end_date || null,
          active: input.active ?? true,
          notes: input.notes?.trim() || null,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as RecurringExpense;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] });
      toast.success("Gasto recurrente creado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo crear el gasto recurrente"),
  });
}

export function useUpdateRecurringExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<RecurringExpenseInput> & { id: string }) => {
      const updates: Record<string, unknown> = { ...input };
      if (typeof input.name === "string") updates.name = input.name.trim();
      if (typeof input.vendor === "string") updates.vendor = input.vendor.trim() || null;
      if (typeof input.notes === "string") updates.notes = input.notes.trim() || null;
      const { error } = await (supabase as any).from("recurring_expenses").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] });
      toast.success("Gasto recurrente actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

export function useDeleteRecurringExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("recurring_expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] });
      toast.success("Gasto recurrente eliminado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
  });
}

/**
 * Genera un gasto real (solicitud) a partir de una plantilla recurrente para
 * una fecha dada. Sirve para "registrar el gasto de este mes" con un clic.
 */
export function useGenerateExpenseFromRecurring() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ recurring, expense_date }: { recurring: RecurringExpense; expense_date: string }) => {
      const organization_id = await currentOrgId(user!.id);
      const reimbursement_type = chargeToReimbursement(recurring.charge_to);
      const { data, error } = await (supabase as any)
        .from("expenses")
        .insert({
          organization_id,
          requested_by: user!.id,
          category: recurring.category,
          amount: recurring.amount,
          currency: recurring.currency,
          description: recurring.vendor ? `${recurring.name} — ${recurring.vendor}` : recurring.name,
          client_id: recurring.client_id,
          project_id: recurring.project_id,
          group_company_id: recurring.group_company_id,
          expense_date,
          reimbursement_type,
          reimbursement_status: reimbursement_type ? "pendiente" : null,
          notes: `Generado desde gasto recurrente (${FREQUENCY_LABELS[recurring.frequency]}).`,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Gasto registrado desde la plantilla recurrente");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar el gasto"),
  });
}
