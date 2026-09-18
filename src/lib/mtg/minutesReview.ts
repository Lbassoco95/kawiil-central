/**
 * Reglas de la pantalla Minuta (B4): confirmar / rechazar / aprobar.
 */

import type { MtgAgreementRow } from "@/lib/mtg/db";

export function isProposed(a: MtgAgreementRow): boolean {
  return a.status === "proposed";
}

export function isIncompleteConfirmed(a: MtgAgreementRow): boolean {
  if (a.status !== "confirmed") return false;
  return !a.project_id || !a.due_date || (!a.owner_user_id && !a.owner_name);
}

export function canApproveMinutes(agreements: MtgAgreementRow[]): {
  ok: boolean;
  reason?: string;
} {
  const proposed = agreements.filter(isProposed);
  if (proposed.length > 0) {
    return { ok: false, reason: `Quedan ${proposed.length} acuerdo(s) propuesto(s) por confirmar o rechazar` };
  }
  const incomplete = agreements.filter(isIncompleteConfirmed);
  if (incomplete.length > 0) {
    return {
      ok: false,
      reason: `Quedan ${incomplete.length} acuerdo(s) confirmado(s) incompletos (proyecto, responsable o fecha)`,
    };
  }
  return { ok: true };
}

export function confirmRequires(opts: {
  projectId?: string | null;
  dueDate?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
}): { ok: boolean; reason?: string } {
  if (!opts.projectId) return { ok: false, reason: "Proyecto obligatorio" };
  if (!opts.dueDate) return { ok: false, reason: "Fecha obligatoria" };
  if (!opts.ownerUserId && !opts.ownerName?.trim()) {
    return { ok: false, reason: "Responsable obligatorio" };
  }
  return { ok: true };
}

export function parseTopicsFromMarkdown(md: string | null | undefined): string[] {
  if (!md) return [];
  const lines = md.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Temas para la próxima/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (inSection) {
      const m = line.match(/^[-*]\s+(.+)/);
      if (m) out.push(m[1].trim());
    }
  }
  return out;
}

export function remindKindsForMeeting(scheduledAt: Date, now = new Date()): Array<{
  kind: "mtg.remind";
  remind_kind: "t1d" | "t1h";
  run_after: Date;
}> {
  const t1d = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
  const t1h = new Date(scheduledAt.getTime() - 60 * 60 * 1000);
  const out: Array<{ kind: "mtg.remind"; remind_kind: "t1d" | "t1h"; run_after: Date }> = [];
  if (t1d > now) out.push({ kind: "mtg.remind", remind_kind: "t1d", run_after: t1d });
  if (t1h > now) out.push({ kind: "mtg.remind", remind_kind: "t1h", run_after: t1h });
  return out;
}
