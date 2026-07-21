import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sanitizeStorageFileName } from "@/lib/storageFilename";

export type StatementSource = "pdf" | "excel" | "csv" | "image" | "manual";
export type StatementStatus = "procesando" | "listo" | "error" | "revisado";
export type MovementDirection = "cargo" | "abono";
export type MovementStatus = "pendiente" | "conciliado" | "ignorado" | "gasto_creado";

export interface BankStatement {
  id: string;
  organization_id: string;
  file_path: string | null;
  file_name: string | null;
  source_type: StatementSource;
  bank_name: string | null;
  account_label: string | null;
  period_start: string | null;
  period_end: string | null;
  status: StatementStatus;
  movements_count: number;
  ai_summary: string | null;
  error_message: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankMovement {
  id: string;
  organization_id: string;
  statement_id: string | null;
  movement_date: string | null;
  description: string | null;
  amount: number;
  direction: MovementDirection;
  currency: string;
  balance: number | null;
  counterparty: string | null;
  suggested_category: string | null;
  category: string | null;
  status: MovementStatus;
  matched_expense_id: string | null;
  recurring_expense_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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

function sourceTypeFromFile(file: File): StatementSource {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type.includes("pdf")) return "pdf";
  if (name.endsWith(".csv") || file.type.includes("csv")) return "csv";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || file.type.includes("sheet") || file.type.includes("excel"))
    return "excel";
  if (file.type.startsWith("image/")) return "image";
  return "pdf";
}

export function useBankStatements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bank-statements"],
    queryFn: async (): Promise<BankStatement[]> => {
      const { data, error } = await (supabase as any)
        .from("bank_statements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BankStatement[];
    },
    enabled: !!user,
  });
}

export function useBankMovements(statementId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bank-movements", statementId ?? "all"],
    queryFn: async (): Promise<BankMovement[]> => {
      let q = (supabase as any)
        .from("bank_movements")
        .select("*")
        .order("movement_date", { ascending: false });
      if (statementId) q = q.eq("statement_id", statementId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BankMovement[];
    },
    enabled: !!user && (statementId === undefined || !!statementId),
  });
}

/**
 * Sube un estado de cuenta (PDF, Excel/CSV o imagen), crea el registro y dispara
 * el desglose con IA. Los movimientos se guardan en el servidor.
 */
export function useUploadBankStatement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, bank_name }: { file: File; bank_name?: string | null }) => {
      const orgId = await currentOrgId(user!.id);
      const source_type = sourceTypeFromFile(file);
      const safe = sanitizeStorageFileName(file.name);
      const objectPath = `finance-statements/${orgId}/${crypto.randomUUID()}_${safe}`;

      const { error: upErr } = await supabase.storage.from("documents").upload(objectPath, file);
      if (upErr) throw upErr;

      const { data: statement, error: insErr } = await (supabase as any)
        .from("bank_statements")
        .insert({
          organization_id: orgId,
          file_path: objectPath,
          file_name: file.name,
          source_type,
          bank_name: bank_name?.trim() || null,
          status: "procesando",
          uploaded_by: user!.id,
        })
        .select()
        .single();
      if (insErr) {
        await supabase.storage.from("documents").remove([objectPath]);
        throw insErr;
      }

      const { data: result, error: fnErr } = await supabase.functions.invoke("finance-parse-statement", {
        body: { mode: "statement", path: objectPath, source_type, statement_id: (statement as BankStatement).id },
      });
      if (fnErr) {
        // El estado queda marcado 'error' por la función; refleja el fallo.
        throw new Error(fnErr.message || "La IA no pudo procesar el estado de cuenta.");
      }
      return { statement: statement as BankStatement, result };
    },
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ["bank-statements"] });
      queryClient.invalidateQueries({ queryKey: ["bank-movements"] });
      const count = (result as { movements_count?: number })?.movements_count ?? 0;
      toast.success(`Estado de cuenta procesado: ${count} movimiento${count === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo procesar el estado de cuenta"),
  });
}

export function useUpdateBankMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      status?: MovementStatus;
      category?: string | null;
      matched_expense_id?: string | null;
      recurring_expense_id?: string | null;
      counterparty?: string | null;
      notes?: string | null;
    }) => {
      const { error } = await (supabase as any).from("bank_movements").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-movements"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el movimiento"),
  });
}

export function useDeleteBankStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (statement: BankStatement) => {
      const { error } = await (supabase as any).from("bank_statements").delete().eq("id", statement.id);
      if (error) throw error;
      if (statement.file_path) {
        await supabase.storage.from("documents").remove([statement.file_path]).catch(() => {});
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-statements"] });
      queryClient.invalidateQueries({ queryKey: ["bank-movements"] });
      toast.success("Estado de cuenta eliminado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
  });
}

/** Crea un gasto (solicitud) a partir de un movimiento bancario y lo concilia. */
export function useCreateExpenseFromMovement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ movement }: { movement: BankMovement }) => {
      const orgId = await currentOrgId(user!.id);
      const category =
        movement.category ||
        (movement.suggested_category && movement.suggested_category !== "otro"
          ? movement.suggested_category
          : "operativo");
      const { data: expense, error } = await (supabase as any)
        .from("expenses")
        .insert({
          organization_id: orgId,
          requested_by: user!.id,
          category,
          amount: movement.amount,
          currency: movement.currency,
          description: movement.description || movement.counterparty || "Movimiento bancario",
          expense_date: movement.movement_date || new Date().toISOString().slice(0, 10),
          status: "pagado",
          paid_by: user!.id,
          paid_at: new Date().toISOString(),
          notes: "Registrado desde un movimiento bancario conciliado.",
        })
        .select()
        .single();
      if (error) throw error;

      await (supabase as any)
        .from("bank_movements")
        .update({ status: "gasto_creado", matched_expense_id: (expense as { id: string }).id, category })
        .eq("id", movement.id);
      return expense;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-movements"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Gasto creado y conciliado desde el movimiento");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo crear el gasto"),
  });
}
