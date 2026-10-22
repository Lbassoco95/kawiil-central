import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { withDedupeKeys, type ParsedStatement } from "@/lib/bankStatement";

// Las tablas bancarias son nuevas y aún no están en types.ts generado.
const db = supabase as unknown as SupabaseClient;

export interface BankAccount {
  id: string;
  organization_id: string;
  name: string;
  bank: string | null;
  last4: string | null;
  currency: string;
  archived: boolean;
}

export interface BankStatement {
  id: string;
  account_id: string;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  file_name: string | null;
  file_path: string | null;
  tx_count: number;
  created_at: string;
}

export interface BankTx {
  id: string;
  account_id: string;
  tx_date: string;
  description: string;
  amount: number;
  balance: number | null;
}

export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  archived: boolean;
}

const num = <T extends Record<string, unknown>>(row: T, keys: string[]) => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k]);
  return out as T;
};

async function orgId(userId: string) {
  const { data, error } = await db.from("profiles").select("organization_id").eq("user_id", userId).single();
  if (error || !data) throw new Error("Perfil no encontrado");
  return data.organization_id as string;
}

export function useBankAccounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bank-accounts"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_bank_accounts")
        .select("*")
        .eq("archived", false)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as BankAccount[];
    },
  });
}

export function useBankStatements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bank-statements"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_bank_statements")
        .select("*")
        .order("period_end", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => num(r, ["opening_balance", "closing_balance"])) as BankStatement[];
    },
  });
}

/** Movimientos de los últimos ~7 meses (para flujo y saldo de respaldo). */
export function useBankTransactions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bank-transactions"],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 7);
      const { data, error } = await db
        .from("finance_bank_transactions")
        .select("id, account_id, tx_date, description, amount, balance")
        .gte("tx_date", since.toISOString().slice(0, 10))
        .order("tx_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []).map((r) => num(r, ["amount", "balance"])) as BankTx[];
    },
  });
}

export function useSavingsGoals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["savings-goals"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_savings_goals")
        .select("*")
        .eq("archived", false)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((r) => num(r, ["target_amount", "saved_amount"])) as SavingsGoal[];
    },
  });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (p: { name: string; bank?: string; last4?: string }) => {
      const organization_id = await orgId(user!.id);
      const { data, error } = await db
        .from("finance_bank_accounts")
        .insert({ organization_id, created_by: user!.id, name: p.name, bank: p.bank || null, last4: p.last4 || null })
        .select()
        .single();
      if (error) throw error;
      return data as BankAccount;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-accounts"] }),
  });
}

export function useImportStatement() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (p: {
      accountId: string;
      file: File;
      parsed: ParsedStatement;
      /** Saldo final capturado a mano cuando el archivo no trae columna de saldo. */
      closingBalanceOverride?: number | null;
    }) => {
      const organization_id = await orgId(user!.id);
      const { parsed } = p;
      const objectPath = `bank-statements/${organization_id}/${p.accountId}/${crypto.randomUUID()}_${sanitizeStorageFileName(p.file.name)}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(objectPath, p.file);
      if (upErr) throw upErr;

      const closing = p.closingBalanceOverride ?? parsed.closingBalance;
      const { data: stmt, error: stErr } = await db
        .from("finance_bank_statements")
        .insert({
          organization_id,
          account_id: p.accountId,
          period_start: parsed.periodStart,
          period_end: parsed.periodEnd,
          opening_balance: parsed.openingBalance,
          closing_balance: closing,
          file_path: objectPath,
          file_name: p.file.name,
          tx_count: parsed.transactions.length,
          uploaded_by: user!.id,
        })
        .select("id")
        .single();
      if (stErr || !stmt) {
        await supabase.storage.from("documents").remove([objectPath]);
        throw stErr ?? new Error("No se pudo guardar el estado de cuenta");
      }

      const rows = withDedupeKeys(parsed.transactions).map((t) => ({
        organization_id,
        account_id: p.accountId,
        statement_id: stmt.id,
        tx_date: t.date,
        description: t.description,
        amount: t.amount,
        balance: t.balance,
        dedupe_key: t.dedupe_key,
      }));
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await db
          .from("finance_bank_transactions")
          .upsert(rows.slice(i, i + 500), { onConflict: "account_id,dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (error) {
          await db.from("finance_bank_statements").delete().eq("id", stmt.id);
          await supabase.storage.from("documents").remove([objectPath]);
          throw error;
        }
        inserted += data?.length ?? 0;
      }
      return { inserted, duplicates: rows.length - inserted };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-statements"] });
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
    },
  });
}

export function useDeleteStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: BankStatement) => {
      const { error } = await db.from("finance_bank_statements").delete().eq("id", s.id);
      if (error) throw error;
      if (s.file_path) await supabase.storage.from("documents").remove([s.file_path]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-statements"] });
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
    },
  });
}

export function useSaveGoal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (g: Partial<SavingsGoal> & { name: string; target_amount: number }) => {
      if (g.id) {
        const { id, ...rest } = g;
        const { error } = await db.from("finance_savings_goals").update(rest).eq("id", id);
        if (error) throw error;
        return;
      }
      const organization_id = await orgId(user!.id);
      const { error } = await db
        .from("finance_savings_goals")
        .insert({ ...g, organization_id, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savings-goals"] }),
  });
}
