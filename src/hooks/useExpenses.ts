import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { createNotifications, getFinanceCelulaUserIds } from "@/lib/notificationHelpers";
import { sanitizeStorageFileName } from "@/lib/storageFilename";

export type ExpenseAttachment = { path: string; name: string };

export function parseExpenseAttachments(expense: Expense): ExpenseAttachment[] {
  const raw = expense.attachments;
  const list: ExpenseAttachment[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const path = (item as { path?: unknown }).path;
      if (typeof path !== "string" || !path) continue;
      const name = (item as { name?: unknown }).name;
      list.push({
        path,
        name: typeof name === "string" && name ? name : path.split("/").pop() || "archivo",
      });
    }
  }
  if (expense.receipt_path?.trim() && !list.some((a) => a.path === expense.receipt_path)) {
    list.push({
      path: expense.receipt_path,
      name: expense.receipt_path.split("/").pop() || "comprobante",
    });
  }
  return list;
}

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
  attachments?: ExpenseAttachment[] | null;
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
  files?: File[];
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateExpenseParams) => {
      const { files = [], ...row } = params;
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile) throw new Error("Perfil no encontrado");

      const orgId = profile.organization_id;
      const batchId = crypto.randomUUID();
      const uploaded: ExpenseAttachment[] = [];

      for (const file of files) {
        const safe = sanitizeStorageFileName(file.name);
        const objectPath = `expenses/${orgId}/${batchId}/${crypto.randomUUID()}_${safe}`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(objectPath, file);
        if (upErr) {
          if (uploaded.length > 0) {
            await supabase.storage.from("documents").remove(uploaded.map((u) => u.path));
          }
          throw upErr;
        }
        uploaded.push({ path: objectPath, name: file.name });
      }

      const { data, error } = await supabase
        .from("expenses")
        .insert({
          ...row,
          attachments: uploaded,
          organization_id: orgId,
          requested_by: user!.id,
        } as any)
        .select()
        .single();
      if (error) {
        if (uploaded.length > 0) {
          await supabase.storage.from("documents").remove(uploaded.map((u) => u.path));
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Solicitud de gasto creada");

      // Notify finance cell users
      try {
        const financeUserIds = await getFinanceCelulaUserIds();
        if (financeUserIds.length > 0 && data) {
          createNotifications(
            financeUserIds.map((uid) => ({
              user_id: uid,
              type: "expense_created",
              title: `Nueva solicitud de gasto: ${(data as any).description?.substring(0, 60) || "Sin descripción"}`,
              body: `$${(data as any).amount} ${(data as any).currency || "MXN"} — ${(data as any).category}`,
              entity_type: "expense",
              entity_id: (data as any).id,
              source_user_id: user!.id,
            }))
          );
        }
      } catch { /* non-critical */ }
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
    onSuccess: async (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Estado actualizado");

      // Notify the expense requester about status change
      try {
        const statusLabels: Record<string, string> = {
          en_revision: "en revisión",
          aprobado: "aprobado",
          rechazado: "rechazado",
          pagado: "pagado",
        };
        const label = statusLabels[vars.status] || vars.status;

        // Fetch the expense to get requested_by
        const { data: expense } = await supabase
          .from("expenses")
          .select("requested_by, description")
          .eq("id", vars.id)
          .single();

        if (expense && expense.requested_by) {
          createNotifications([{
            user_id: expense.requested_by,
            type: "expense_status_changed",
            title: `Tu gasto fue ${label}`,
            body: expense.description?.substring(0, 200) || undefined,
            entity_type: "expense",
            entity_id: vars.id,
            source_user_id: user!.id,
          }]);
        }
      } catch { /* non-critical */ }
    },
    onError: (e: any) => toast.error(e.message || "Error al actualizar"),
  });
}
