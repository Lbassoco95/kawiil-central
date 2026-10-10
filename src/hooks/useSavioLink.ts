import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Enlace Kawiil ↔ Savio (RF-05): empareja clientes locales sin savio_customer_id
 * con clientes Savio (savio_customers) sin ficha local. El enlace es una escritura
 * LOCAL; solo "crear en Savio" es una escritura externa (bajo confirmación manual).
 */
export interface UnlinkedClient {
  id: string;
  name: string;
  rfc: string | null;
  email: string | null;
}
export interface UnlinkedSavioCustomer {
  savio_id: string;
  name: string | null;
  rfc: string | null;
  email: string | null;
}

/** Normaliza para comparar nombres (mayúsculas, sin acentos ni puntuación). */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(SA|DE|CV|SAPI|SC|SRL|SOFOM|ENR|THE|LA|EL|LOS|LAS)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function normalizeRfc(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

/** Sugiere el mejor cliente Savio para un cliente local (por RFC exacto o nombre). */
export function suggestSavioMatch(
  client: UnlinkedClient,
  candidates: UnlinkedSavioCustomer[],
): { candidate: UnlinkedSavioCustomer; score: number; by: "rfc" | "nombre" } | null {
  const rfc = normalizeRfc(client.rfc);
  if (rfc) {
    const byRfc = candidates.find((c) => normalizeRfc(c.rfc) && normalizeRfc(c.rfc) === rfc);
    if (byRfc) return { candidate: byRfc, score: 1, by: "rfc" };
  }
  const name = normalizeName(client.name);
  if (name) {
    const exact = candidates.find((c) => normalizeName(c.name) === name);
    if (exact) return { candidate: exact, score: 0.9, by: "nombre" };
    const partial = candidates.find((c) => {
      const cn = normalizeName(c.name);
      return cn && (cn.includes(name) || name.includes(cn));
    });
    if (partial) return { candidate: partial, score: 0.6, by: "nombre" };
  }
  return null;
}

async function currentOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("organization_id").eq("user_id", userId).single();
  if (error || !data?.organization_id) throw new Error("No se encontró la organización del usuario");
  return data.organization_id as string;
}

export function useUnlinkedClients() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["unlinked-clients"],
    queryFn: async (): Promise<UnlinkedClient[]> => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, rfc, email")
        .is("savio_customer_id", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as UnlinkedClient[];
    },
    enabled: !!user,
  });
}

export function useUnlinkedSavioCustomers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["unlinked-savio-customers"],
    queryFn: async (): Promise<UnlinkedSavioCustomer[]> => {
      const { data, error } = await (supabase as any)
        .from("savio_customers")
        .select("savio_id, name, rfc, email")
        .is("client_id", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as UnlinkedSavioCustomer[];
    },
    enabled: !!user,
  });
}

function invalidateLinks(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["unlinked-clients"] });
  qc.invalidateQueries({ queryKey: ["unlinked-savio-customers"] });
  qc.invalidateQueries({ queryKey: ["clients"] });
  qc.invalidateQueries({ queryKey: ["aging"] });
}

/** Enlaza (local) un cliente Kawiil con un cliente Savio existente. */
export function useLinkClientSavio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, savioId }: { clientId: string; savioId: string }) => {
      const now = new Date().toISOString();
      const { error: cErr } = await supabase
        .from("clients")
        .update({ savio_customer_id: savioId, savio_customer_linked_at: now } as any)
        .eq("id", clientId);
      if (cErr) throw cErr;
      const { error: sErr } = await (supabase as any)
        .from("savio_customers")
        .update({ client_id: clientId })
        .eq("savio_id", savioId);
      if (sErr) throw sErr;
    },
    onSuccess: () => { invalidateLinks(qc); toast.success("Cliente enlazado con Savio"); },
    onError: (e: Error) => toast.error(e.message || "No se pudo enlazar"),
  });
}

/** Crea una ficha local a partir de un cliente Savio y la enlaza. */
export function useCreateLocalFromSavio() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (sc: UnlinkedSavioCustomer) => {
      const organization_id = await currentOrgId(user!.id);
      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          organization_id,
          name: sc.name || `Cliente Savio ${sc.savio_id.slice(0, 8)}`,
          rfc: sc.rfc,
          email: sc.email,
          savio_customer_id: sc.savio_id,
          savio_customer_linked_at: new Date().toISOString(),
          created_by: user!.id,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      await (supabase as any)
        .from("savio_customers")
        .update({ client_id: (created as { id: string }).id })
        .eq("savio_id", sc.savio_id);
    },
    onSuccess: () => { invalidateLinks(qc); toast.success("Ficha local creada y enlazada"); },
    onError: (e: Error) => toast.error(e.message || "No se pudo crear la ficha"),
  });
}

/** Crea el cliente en Savio (escritura externa) y guarda el vínculo. */
export function useCreateSavioFromClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (client: UnlinkedClient) => {
      const payload: Record<string, unknown> = { name: client.name, legal_name: client.name };
      if (client.email) payload.email = client.email;
      if (client.rfc) { payload.rfc = client.rfc; payload.tax_id = client.rfc; }
      const { data, error } = await supabase.functions.invoke("savio-finance-write", {
        body: { operation: "create_customer", payload },
      });
      if (error) throw new Error(error.message || "No se pudo crear en Savio");
      const res = data as { ok?: boolean; data?: Record<string, unknown>; message?: string };
      if (!res.ok) throw new Error(res.message || "Savio rechazó la creación del cliente");
      const savioObj = (res.data ?? {}) as Record<string, unknown>;
      const inner = (savioObj.data ?? savioObj) as Record<string, unknown>;
      const savioId = String(inner.id ?? inner.uuid ?? inner.customer_id ?? "").trim();
      if (!savioId) throw new Error("Savio no devolvió el id del cliente creado");
      const now = new Date().toISOString();
      await supabase
        .from("clients")
        .update({ savio_customer_id: savioId, savio_customer_linked_at: now } as any)
        .eq("id", client.id);
      // La fila en savio_customers (con client_id resuelto) la crea el próximo
      // savio-sync a partir de clients.savio_customer_id que acabamos de fijar.
    },
    onSuccess: () => { invalidateLinks(qc); toast.success("Cliente creado en Savio y enlazado"); },
    onError: (e: Error) => toast.error(e.message || "No se pudo crear en Savio"),
  });
}
