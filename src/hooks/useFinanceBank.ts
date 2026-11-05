import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEFAULT_CATEGORIES, buildRuleIndex, extractPatterns, type CategoryDef, type CategoryKind, type Rule,
} from "@/lib/finance/classifier";
import type { ParsedMovement } from "@/lib/finance/bankImport";
import type { ParsedCommitment } from "@/lib/finance/commitmentImport";
import { detectEntity } from "@/lib/finance/thirdParty";
import { dropAlreadyLoaded } from "@/lib/finance/dedupe";

// Las tablas finance_* son nuevas y aún no están en los tipos generados de Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface FinanceAccount {
  id: string; name: string; kind: "banco" | "efectivo" | "otro"; institution: string | null;
  opening_balance: number; counts_as_available: boolean; is_active: boolean; notes: string | null;
  parent_account_id: string | null; bank_code?: string | null;
  import_profile?: { headerRow: number; mapping: Record<string, number>; headers: string[] } | null;
}
export interface FinanceMovement {
  id: string; account_id: string; movement_date: string; description: string; reference: string | null;
  debit: number; credit: number; reported_balance: number | null; category: string | null;
  category_source: "manual" | "regla" | "excel" | "sugerida" | null; review_status: "pendiente" | "clasificado";
  excluded_from_flow: boolean; notes: string | null; entity: string | null; row_seq: number | null;
}
export interface FinanceGoal {
  id?: string; year: number; month: number; income_target: number; expense_budget: number;
  new_clients_target: number; avg_new_client_monthly: number; notes?: string | null;
}

export interface FinanceCommitment {
  id: string; direction: "pagar" | "cobrar"; counterparty: string | null; concept: string; amount: number;
  currency: string; original_amount: number | null; fx_rate: number | null; due_date: string | null;
  status: "pendiente" | "pagado" | "cancelado"; category: string | null; source: string; external_key: string | null;
  notes: string | null; settled_at: string | null;
}

export const financeBankKeys = {
  banks: ["finance-banks"] as const,
  commitments: ["finance-commitments"] as const,
  accounts: ["finance-accounts"] as const,
  movements: ["finance-movements"] as const,
  categories: ["finance-categories"] as const,
  rules: ["finance-rules"] as const,
  goals: ["finance-goals"] as const,
};

/** Todas las escrituras necesitan la organización; sin ella la base rechaza la fila por seguridad. */
function requireOrg(orgId: string | undefined): string {
  if (!orgId) throw new Error("No se pudo identificar tu organización. Recarga la página e inténtalo de nuevo.");
  return orgId;
}

async function fetchAll<T>(table: string, order: string, ascending = false): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from(table).select("*").order(order, { ascending }).range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export function useOrgId() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["finance-org-id", user?.id],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("organization_id").eq("user_id", user!.id).single();
      if (error) throw error;
      return data.organization_id as string;
    },
  });
}

export function useFinanceAccounts() {
  return useQuery({ queryKey: financeBankKeys.accounts, queryFn: () => fetchAll<FinanceAccount>("finance_accounts", "name", true) });
}
export function useFinanceMovements() {
  return useQuery({ queryKey: financeBankKeys.movements, queryFn: () => fetchAll<FinanceMovement>("finance_movements", "movement_date", false) });
}
export function useFinanceCommitments() {
  return useQuery({ queryKey: financeBankKeys.commitments, queryFn: () => fetchAll<FinanceCommitment>("finance_commitments", "due_date", true) });
}
export function useFinanceGoals() {
  return useQuery({ queryKey: financeBankKeys.goals, queryFn: () => fetchAll<FinanceGoal>("finance_goals", "year", true) });
}
export function useFinanceRules() {
  return useQuery({ queryKey: financeBankKeys.rules, queryFn: () => fetchAll<Rule & { id: string }>("finance_category_rules", "hits", false) });
}

/** Categorías base + las creadas/aprendidas por la organización. */
export function useFinanceCategories() {
  const q = useQuery({ queryKey: financeBankKeys.categories, queryFn: () => fetchAll<CategoryDef & { id: string }>("finance_categories", "name", true) });
  const categories = useMemo(() => {
    const map = new Map<string, CategoryDef>();
    DEFAULT_CATEGORIES.forEach((c) => map.set(c.name, c));
    (q.data ?? []).forEach((c) => map.set(c.name, { name: c.name, kind: c.kind }));
    return [...map.values()];
  }, [q.data]);
  return { ...q, categories };
}

export function useRuleIndex() {
  const { data } = useFinanceRules();
  return useMemo(() => buildRuleIndex(data ?? []), [data]);
}

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Suma 1 a cada patrón aprendido (patrón + categoría). */
async function learnRules(orgId: string, items: { patterns: string[]; category: string }[]) {
  const counts = new Map<string, { pattern: string; category: string; n: number }>();
  for (const it of items) for (const p of it.patterns) {
    const k = `${p}\u0000${it.category}`;
    const c = counts.get(k) ?? { pattern: p, category: it.category, n: 0 };
    c.n++; counts.set(k, c);
  }
  if (counts.size === 0) return;
  const keys = [...counts.values()];
  const existing = new Map<string, number>();
  for (const part of chunk([...new Set(keys.map((k) => k.pattern))], 200)) {
    const { data } = await db.from("finance_category_rules").select("pattern,category,hits").eq("organization_id", orgId).in("pattern", part);
    (data ?? []).forEach((r: Rule) => existing.set(`${r.pattern}\u0000${r.category}`, r.hits));
  }
  const rows = keys.map((k) => ({
    organization_id: orgId, pattern: k.pattern, category: k.category,
    hits: (existing.get(`${k.pattern}\u0000${k.category}`) ?? 0) + k.n, last_used_at: new Date().toISOString(),
  }));
  for (const part of chunk(rows, 500)) {
    const { error } = await db.from("finance_category_rules").upsert(part, { onConflict: "organization_id,pattern,category" });
    if (error) throw error;
  }
}

async function ensureCategories(orgId: string, names: { name: string; kind: CategoryKind }[], known: CategoryDef[]) {
  const have = new Set(known.map((c) => c.name));
  const toAdd = names.filter((c) => !have.has(c.name)).map((c) => ({ organization_id: orgId, name: c.name, kind: c.kind }));
  if (toAdd.length) {
    const { error } = await db.from("finance_categories").upsert(toAdd, { onConflict: "organization_id,name" });
    if (error) throw error;
  }
}

export function useCreateAccount() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  return useMutation({
    mutationFn: async (a: Pick<FinanceAccount, "name" | "kind"> & Partial<FinanceAccount>) => {
      const { data, error } = await db.from("finance_accounts")
        .upsert({ organization_id: requireOrg(orgId), ...a }, { onConflict: "organization_id,name" }).select().single();
      if (error) throw error;
      return data as FinanceAccount;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: financeBankKeys.accounts }),
    onError: (e: Error) => toast.error(`No se pudo guardar la cuenta: ${e.message}`),
  });
}

export interface ImportPayload {
  accountId: string;
  source: "excel" | "pegado";
  filename?: string;
  movements: (ParsedMovement & { category?: string | null })[];
  openingBalance?: number | null;
  /** Categorías (con su tipo) que vienen ya clasificadas desde el Excel. */
  knownCategories: CategoryDef[];
  /** Hoja de terceros: se detecta la entidad (cliente dueño del dinero) de cada movimiento. */
  detectEntities?: boolean;
  /** Función que sugiere categoría automática a los movimientos nuevos. */
  suggest: (m: ParsedMovement) => { category: string; autoApply: boolean } | null;
}

export function useImportMovements() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (p: ImportPayload) => {
      if (!orgId) throw new Error("Organización no disponible");
      const kindOf = (name: string) => p.knownCategories.find((c) => c.name === name)?.kind ?? "gasto";
      // 1) Cuáles ya existen (por dedupe_hash) para no duplicar.
      const existing = new Set<string>();
      for (const part of chunk(p.movements.map((m) => m.dedupeKey), 200)) {
        const { data, error } = await db.from("finance_movements").select("dedupe_hash")
          .eq("organization_id", orgId).eq("account_id", p.accountId).in("dedupe_hash", part);
        if (error) throw error;
        (data ?? []).forEach((r: { dedupe_hash: string }) => existing.add(r.dedupe_hash));
      }
      const exactFresh = p.movements.filter((m) => !existing.has(m.dedupeKey));
      // Mismo movimiento con otra redacción (Excel vs. PDF vs. captura): se detecta por fecha e importes.
      let fresh = exactFresh;
      if (exactFresh.length > 0) {
        const dates = p.movements.map((m) => m.date).sort();
        const incomingKeys = new Set(p.movements.map((m) => m.dedupeKey));
        const sameAmounts: { date: string; debit: number; credit: number }[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db.from("finance_movements").select("movement_date,debit,credit,dedupe_hash")
            .eq("organization_id", orgId).eq("account_id", p.accountId)
            .gte("movement_date", dates[0]).lte("movement_date", dates[dates.length - 1]).range(from, from + 999);
          if (error) throw error;
          for (const r of data ?? []) if (!incomingKeys.has(r.dedupe_hash)) sameAmounts.push({ date: r.movement_date, debit: Number(r.debit), credit: Number(r.credit) });
          if (!data || data.length < 1000) break;
        }
        fresh = dropAlreadyLoaded(exactFresh, sameAmounts);
      }
      // 2) Lote.
      const { data: batch, error: bErr } = await db.from("finance_import_batches").insert({
        organization_id: orgId, account_id: p.accountId, source: p.source, filename: p.filename ?? null,
        rows_total: p.movements.length, rows_new: fresh.length, rows_duplicate: p.movements.length - fresh.length,
        created_by: user?.id ?? null,
      }).select("id").single();
      if (bErr) throw bErr;
      // 3) Clasificación: la del Excel manda; si no, la sugerencia aprendida si es de alta confianza.
      const learned: { patterns: string[]; category: string }[] = [];
      const newCats = new Map<string, CategoryKind>();
      const rows = fresh.map((m) => {
        let category: string | null = m.category ?? null;
        let source: "excel" | "regla" | null = category ? "excel" : null;
        if (!category) {
          const s = p.suggest(m);
          if (s?.autoApply) { category = s.category; source = "regla"; }
        }
        if (category) {
          if (source === "excel") learned.push({ patterns: extractPatterns(m), category });
          if (!p.knownCategories.some((c) => c.name === category)) newCats.set(category, m.credit > m.debit ? "ingreso" : "gasto");
        }
        return {
          organization_id: orgId, account_id: p.accountId, batch_id: batch.id,
          movement_date: m.date, description: m.description, reference: m.reference,
          debit: m.debit, credit: m.credit, reported_balance: m.balance,
          category, category_source: source, review_status: category ? "clasificado" : "pendiente",
          excluded_from_flow: category ? kindOf(category) === "neutral" : false,
          notes: m.observation, entity: p.detectEntities ? detectEntity(m.description, m.observation) : null,
          row_seq: p.source === "excel" ? m.seq : null,
          dedupe_hash: m.dedupeKey, created_by: user?.id ?? null,
        };
      });
      await ensureCategories(orgId, [...newCats].map(([name, kind]) => ({ name, kind })), p.knownCategories);
      for (const part of chunk(rows, 500)) {
        const { error } = await db.from("finance_movements").upsert(part, { onConflict: "organization_id,account_id,dedupe_hash", ignoreDuplicates: true });
        if (error) throw error;
      }
      await learnRules(orgId, learned);
      if (p.openingBalance != null) {
        await db.from("finance_accounts").update({ opening_balance: p.openingBalance }).eq("id", p.accountId).eq("opening_balance", 0);
      }
      return { total: p.movements.length, added: fresh.length, duplicates: p.movements.length - fresh.length, pending: rows.filter((r) => !r.category).length };
    },
    onSuccess: () => {
      for (const k of Object.values(financeBankKeys)) qc.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => toast.error(`No se pudo importar: ${e.message}`),
  });
}

/** Clasifica movimientos a mano o al aceptar una sugerencia, y enseña al sistema. */
export function useClassifyMovements() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  const { categories } = useFinanceCategories();
  return useMutation({
    mutationFn: async (p: { items: FinanceMovement[]; category: string; kind?: CategoryKind; source?: "manual" | "sugerida" }) => {
      if (!orgId) throw new Error("Organización no disponible");
      const kind = p.kind ?? categories.find((c) => c.name === p.category)?.kind ?? "gasto";
      await ensureCategories(orgId, [{ name: p.category, kind }], categories);
      for (const part of chunk(p.items.map((i) => i.id), 200)) {
        const { error } = await db.from("finance_movements").update({
          category: p.category, category_source: p.source ?? "manual", review_status: "clasificado",
          excluded_from_flow: kind === "neutral",
        }).in("id", part);
        if (error) throw error;
      }
      await learnRules(orgId, p.items.map((m) => ({
        patterns: extractPatterns({ description: m.description, reference: m.reference, debit: Number(m.debit), credit: Number(m.credit) }),
        category: p.category,
      })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financeBankKeys.movements });
      qc.invalidateQueries({ queryKey: financeBankKeys.rules });
      qc.invalidateQueries({ queryKey: financeBankKeys.categories });
    },
    onError: (e: Error) => toast.error(`No se pudo clasificar: ${e.message}`),
  });
}

export function useAddManualMovement() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (m: { account_id: string; movement_date: string; description: string; debit: number; credit: number; category?: string | null; excluded?: boolean }) => {
      const org = requireOrg(orgId);
      const dedupe = `manual|${crypto.randomUUID()}`;
      const { error } = await db.from("finance_movements").insert({
        organization_id: org, ...m, category: m.category ?? null,
        category_source: m.category ? "manual" : null, review_status: m.category ? "clasificado" : "pendiente",
        excluded_from_flow: m.excluded ?? false, dedupe_hash: dedupe, created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: financeBankKeys.movements }); toast.success("Movimiento registrado"); },
    onError: (e: Error) => toast.error(`No se pudo registrar: ${e.message}`),
  });
}

export function useSaveGoals() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  return useMutation({
    mutationFn: async (goals: FinanceGoal[]) => {
      const rows = goals.map((g) => ({ ...g, organization_id: requireOrg(orgId) }));
      const { error } = await db.from("finance_goals").upsert(rows, { onConflict: "organization_id,year,month" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: financeBankKeys.goals }); toast.success("Metas guardadas"); },
    onError: (e: Error) => toast.error(`No se pudieron guardar las metas: ${e.message}`),
  });
}

export function useImportCommitments() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (items: ParsedCommitment[]) => {
      if (!orgId) throw new Error("Organización no disponible");
      const existing = new Map<string, { id: string; status: string }>();
      for (const part of chunk(items.map((i) => i.externalKey), 100)) {
        const { data, error } = await db.from("finance_commitments").select("id,status,external_key").eq("organization_id", orgId).in("external_key", part);
        if (error) throw error;
        (data ?? []).forEach((r: { id: string; status: string; external_key: string }) => existing.set(r.external_key, r));
      }
      const fresh = items.filter((i) => !existing.has(i.externalKey));
      const rows = fresh.map((i) => ({
        organization_id: orgId, direction: i.direction, counterparty: i.counterparty, concept: i.concept, amount: i.amount,
        currency: i.currency, original_amount: i.originalAmount, fx_rate: i.fxRate, due_date: i.dueDate, status: i.status,
        category: i.category, source: `excel:${i.kind}`, external_key: i.externalKey, notes: i.notes, created_by: user?.id ?? null,
        settled_at: i.status === "pagado" ? new Date().toISOString().slice(0, 10) : null,
      }));
      for (const part of chunk(rows, 200)) {
        const { error } = await db.from("finance_commitments").insert(part);
        if (error) throw error;
      }
      // Si el Excel ya marca como pagado algo que aquí seguía pendiente, se actualiza (nunca se reabre lo cerrado en la app).
      const toClose = items.filter((i) => i.status === "pagado" && existing.get(i.externalKey)?.status === "pendiente");
      for (const i of toClose) {
        await db.from("finance_commitments").update({ status: "pagado", settled_at: new Date().toISOString().slice(0, 10) }).eq("id", existing.get(i.externalKey)!.id);
      }
      return { added: fresh.length, existing: items.length - fresh.length, closed: toClose.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: financeBankKeys.commitments }),
    onError: (e: Error) => toast.error(`No se pudieron cargar los compromisos: ${e.message}`),
  });
}

export function useSaveCommitment() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (c: Partial<FinanceCommitment> & { id?: string }) => {
      if (c.id) {
        const { id, ...patch } = c;
        const { error } = await db.from("finance_commitments").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await db.from("finance_commitments").insert({ organization_id: requireOrg(orgId), source: "manual", created_by: user?.id ?? null, ...c });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: financeBankKeys.commitments }),
    onError: (e: Error) => toast.error(`No se pudo guardar el compromiso: ${e.message}`),
  });
}

export function useSetMovementEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { ids: string[]; entity: string }) => {
      for (const part of chunk(p.ids, 200)) {
        const { error } = await db.from("finance_movements").update({ entity: p.entity }).in("id", part);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: financeBankKeys.movements }),
    onError: (e: Error) => toast.error(`No se pudo asignar la entidad: ${e.message}`),
  });
}

export interface FinanceBank { id: string; name: string; code: string | null; source: string }

export function useFinanceBanks() {
  return useQuery({ queryKey: financeBankKeys.banks, queryFn: () => fetchAll<FinanceBank>("finance_banks", "name", true) });
}

export function useImportBanks() {
  const qc = useQueryClient();
  const { data: orgId } = useOrgId();
  return useMutation({
    mutationFn: async (p: { entries: { name: string; code: string | null }[]; source: "banxico" | "manual" }) => {
      if (!orgId) throw new Error("Organización no disponible");
      const rows = p.entries.map((e) => ({ organization_id: orgId, name: e.name, code: e.code, source: p.source }));
      for (const part of chunk(rows, 300)) {
        const { error } = await db.from("finance_banks").upsert(part, { onConflict: "organization_id,name" });
        if (error) throw error;
      }
      return rows.length;
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: financeBankKeys.banks }); toast.success(`${n} instituciones guardadas`); },
    onError: (e: Error) => toast.error(`No se pudo guardar el catálogo: ${e.message}`),
  });
}

export function useSaveImportProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { accountId: string; profile: NonNullable<FinanceAccount["import_profile"]> }) => {
      const { error } = await db.from("finance_accounts").update({ import_profile: p.profile }).eq("id", p.accountId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: financeBankKeys.accounts }),
  });
}
