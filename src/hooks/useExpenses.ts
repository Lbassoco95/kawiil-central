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
  payment_due_date: string | null;
  payment_task_id: string | null;
  reimbursement_type: ReimbursementType | null;
  reimbursement_status: "pendiente" | "completado" | null;
  created_at: string;
  updated_at: string;
}

/** Naturaleza del reembolso de un gasto. */
export type ReimbursementType = "cobrar_cliente" | "reembolsar_trabajador";

export const REIMBURSEMENT_LABELS: Record<ReimbursementType, string> = {
  cobrar_cliente: "Cobrar al cliente",
  reembolsar_trabajador: "Reembolsar al trabajador",
};

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
  /** Si el gasto es reembolsable y de qué tipo (indicado por quien solicita). */
  reimbursement_type?: ReimbursementType | null;
  files?: File[];
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateExpenseParams) => {
      const { files = [], reimbursement_type = null, ...row } = params;
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
          reimbursement_type,
          reimbursement_status: reimbursement_type ? "pendiente" : null,
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

/** Construye el título de la tarea de pago/reembolso a partir del gasto. */
function buildPaymentTaskTitle(
  reimbursementType: ReimbursementType | null | undefined,
  description: string,
  amount: number,
  currency: string,
): string {
  const money = `$${Number(amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;
  const desc = (description || "gasto").trim().slice(0, 80);
  if (reimbursementType === "cobrar_cliente") return `Cobrar al cliente: ${desc} — ${money}`;
  if (reimbursementType === "reembolsar_trabajador") return `Reembolso a trabajador: ${desc} — ${money}`;
  return `Pago: ${desc} — ${money}`;
}

export function useUpdateExpenseStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      rejection_reason,
      payment_due_date,
      reimbursement_type,
    }: {
      id: string;
      status: string;
      rejection_reason?: string;
      /** Fecha en que se debe realizar el pago (requerida al aprobar). */
      payment_due_date?: string | null;
      /** Naturaleza del reembolso; null = no reembolsable. */
      reimbursement_type?: ReimbursementType | null;
    }) => {
      const now = new Date().toISOString();
      const updates: Record<string, any> = { status };

      // Necesitamos datos del gasto para el ciclo de vida de la tarea de pago.
      const { data: expense, error: fetchErr } = await supabase
        .from("expenses")
        .select(
          "organization_id, requested_by, description, amount, currency, category, client_id, project_id, payment_task_id, reimbursement_type",
        )
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;

      if (status === "en_revision") {
        updates.reviewed_by = user!.id;
        updates.reviewed_at = now;
      } else if (status === "aprobado") {
        updates.approved_by = user!.id;
        updates.approved_at = now;
        updates.payment_due_date = payment_due_date || null;
        updates.reimbursement_type = reimbursement_type ?? null;
        updates.reimbursement_status = reimbursement_type ? "pendiente" : null;
      } else if (status === "rechazado") {
        updates.approved_by = user!.id;
        updates.approved_at = now;
        updates.rejection_reason = rejection_reason || null;
      } else if (status === "pagado") {
        updates.paid_by = user!.id;
        updates.paid_at = now;
        // Reembolsar al trabajador: pagar el gasto ES el reembolso, así que se
        // completa junto con el pago. "Cobrar al cliente" NO: que el despacho
        // pague al proveedor no significa que ya cobró al cliente; ese cobro se
        // cierra aparte con "marcar reembolso cobrado".
        if ((expense as any)?.reimbursement_type === "reembolsar_trabajador") {
          updates.reimbursement_status = "completado";
        }
      }

      const { error } = await supabase
        .from("expenses")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;

      // --- Ciclo de vida de la tarea de pago/reembolso ---
      const existingTaskId = (expense as any)?.payment_task_id as string | null;

      if (status === "aprobado" && !existingTaskId) {
        // Responsable(s) de pagos desde la configuración de la organización.
        let primaryAssignee: string | null = null;
        let additionalAssignees: string[] = [];
        try {
          const { data: org } = await supabase
            .from("organizations")
            .select("settings")
            .eq("id", (expense as any).organization_id)
            .single();
          const settings = ((org?.settings as Record<string, any>) || {});
          primaryAssignee = settings.payment_assignee_user_id || null;
          const extra = settings.payment_additional_assignee_user_ids;
          additionalAssignees = Array.isArray(extra)
            ? extra.filter((u: unknown): u is string => typeof u === "string" && !!u && u !== primaryAssignee)
            : [];
        } catch { /* sin configuración: se crea la tarea sin asignar */ }

        const title = buildPaymentTaskTitle(
          reimbursement_type,
          (expense as any).description,
          (expense as any).amount,
          (expense as any).currency,
        );
        const descParts = [
          `Gasto aprobado (${(expense as any).category}).`,
          reimbursement_type === "cobrar_cliente"
            ? "El cliente debe reembolsar este monto al despacho."
            : reimbursement_type === "reembolsar_trabajador"
              ? "El despacho debe reembolsar este monto al trabajador."
              : null,
        ].filter(Boolean);

        const { data: task, error: taskErr } = await supabase
          .from("tasks")
          .insert({
            organization_id: (expense as any).organization_id,
            title,
            description: descParts.join(" "),
            priority: "alta",
            status: "pendiente",
            due_date: payment_due_date || null,
            assigned_to: primaryAssignee,
            client_id: (expense as any).client_id,
            project_id: (expense as any).project_id,
            created_by: user!.id,
          } as any)
          .select("id")
          .single();
        if (taskErr) throw taskErr;

        // Vincula la tarea al gasto.
        await supabase.from("expenses").update({ payment_task_id: task.id } as any).eq("id", id);

        // Co-asignados adicionales.
        if (additionalAssignees.length > 0) {
          await supabase
            .from("task_assignees")
            .insert(additionalAssignees.map((uid) => ({ task_id: task.id, user_id: uid })));
        }

        // Notifica a los responsables de pagos.
        const notifyIds = [...new Set([primaryAssignee, ...additionalAssignees].filter(Boolean))] as string[];
        if (notifyIds.length > 0) {
          createNotifications(
            notifyIds.map((uid) => ({
              user_id: uid,
              type: "task_assigned",
              title: `Pago por realizar: ${title}`,
              body: descParts.join(" ") || undefined,
              entity_type: "task",
              entity_id: task.id,
              source_user_id: user!.id,
            })),
          );
        }
      } else if (status === "pagado" && existingTaskId) {
        // El pago se realizó: cierra la tarea vinculada, salvo en "cobrar al
        // cliente", cuya tarea es de cobro y sigue abierta hasta que el cliente
        // reembolse (se cierra con "marcar reembolso cobrado").
        if ((expense as any)?.reimbursement_type !== "cobrar_cliente") {
          await supabase
            .from("tasks")
            .update({ status: "completada", completed_at: now } as any)
            .eq("id", existingTaskId);
        }
      } else if (status === "rechazado" && existingTaskId) {
        // Gasto rechazado tras aprobarse: cancela la tarea de pago.
        await supabase
          .from("tasks")
          .update({ status: "cancelada" } as any)
          .eq("id", existingTaskId);
      }
    },
    onSuccess: async (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", "mine"] });
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

/**
 * Marca un reembolso como completado (cobrado al cliente o pagado al trabajador)
 * de forma independiente al estatus de pago del gasto. Cierra la tarea de
 * cobro/reembolso vinculada y avisa a quien solicitó el gasto.
 */
export function useMarkReimbursementDone() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const now = new Date().toISOString();
      const { data: expense, error: fetchErr } = await supabase
        .from("expenses")
        .select("payment_task_id, requested_by, description, reimbursement_type")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;

      const { error } = await supabase
        .from("expenses")
        .update({ reimbursement_status: "completado" } as any)
        .eq("id", id);
      if (error) throw error;

      // Cierra la tarea de cobro/reembolso vinculada.
      if ((expense as any)?.payment_task_id) {
        await supabase
          .from("tasks")
          .update({ status: "completada", completed_at: now } as any)
          .eq("id", (expense as any).payment_task_id);
      }

      return expense;
    },
    onSuccess: (expense, vars) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", "mine"] });
      const done =
        (expense as any)?.reimbursement_type === "cobrar_cliente"
          ? "Cobro al cliente registrado"
          : "Reembolso marcado como completado";
      toast.success(done);

      try {
        if ((expense as any)?.requested_by) {
          createNotifications([{
            user_id: (expense as any).requested_by,
            type: "expense_status_changed",
            title:
              (expense as any).reimbursement_type === "cobrar_cliente"
                ? "El cobro al cliente de tu gasto se completó"
                : "Tu reembolso fue completado",
            body: (expense as any).description?.substring(0, 200) || undefined,
            entity_type: "expense",
            entity_id: vars.id,
            source_user_id: user!.id,
          }]);
        }
      } catch { /* non-critical */ }
    },
    onError: (e: any) => toast.error(e.message || "Error al actualizar el reembolso"),
  });
}
