import { toDateStringMX, toMXDate } from "@/lib/dateUtils";

/** Campos mínimos de plantilla para calcular fechas (alineado a `compliance_task_templates`). */
export type ComplianceTemplateForDueDates = {
  periodicity: string;
  due_day: number | null;
  due_month: number | null;
  due_month_2: number | null;
};

export function calculateDueDates(
  template: ComplianceTemplateForDueDates,
  year: number
): { dueDate: string; period: string }[] {
  const results: { dueDate: string; period: string }[] = [];

  switch (template.periodicity) {
    case "mensual": {
      for (let m = 1; m <= 12; m++) {
        const day = template.due_day || 17;
        const dueMonth = m === 12 ? 1 : m + 1;
        const dueYear = m === 12 ? year + 1 : year;
        const lastDay = new Date(dueYear, dueMonth, 0).getDate();
        const d = Math.min(day, lastDay);
        results.push({
          dueDate: `${dueYear}-${String(dueMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          period: `${year}-${String(m).padStart(2, "0")}`,
        });
      }
      break;
    }
    case "trimestral": {
      const quarters = [
        { label: "Q1", dueMonth: 3, dueDay: 31 },
        { label: "Q2", dueMonth: 6, dueDay: 30 },
        { label: "Q3", dueMonth: 9, dueDay: 30 },
        { label: "Q4", dueMonth: 12, dueDay: 31 },
      ];
      for (const q of quarters) {
        results.push({
          dueDate: `${year}-${String(q.dueMonth).padStart(2, "0")}-${String(q.dueDay).padStart(2, "0")}`,
          period: `${year}-${q.label}`,
        });
      }
      break;
    }
    case "semestral": {
      const m1 = template.due_month || 6;
      const m2 = template.due_month_2 || 12;
      const lastDay1 = new Date(year, m1, 0).getDate();
      const lastDay2 = new Date(year, m2, 0).getDate();
      results.push({
        dueDate: `${year}-${String(m1).padStart(2, "0")}-${String(lastDay1).padStart(2, "0")}`,
        period: `${year}-S1`,
      });
      results.push({
        dueDate: `${year}-${String(m2).padStart(2, "0")}-${String(lastDay2).padStart(2, "0")}`,
        period: `${year}-S2`,
      });
      break;
    }
    case "anual": {
      const m = template.due_month || 1;
      const lastDay = new Date(year, m, 0).getDate();
      results.push({
        dueDate: `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        period: `${year}`,
      });
      break;
    }
    case "cuando_aplique": {
      results.push({
        dueDate: "",
        period: `${year}`,
      });
      break;
    }
  }

  return results;
}

/**
 * Primer día en que aplica el calendario de cumplimiento para un proyecto (CDMX):
 * `start_date` si existe, si no `created_at`.
 * Evita generar obligaciones con vencimiento antes de la apertura del proyecto.
 */
export function complianceAnchorYmdFromProject(
  startDate: string | null | undefined,
  createdAt: string | null | undefined,
): string {
  const raw = (startDate && String(startDate).trim()) || createdAt;
  if (!raw) return toDateStringMX();
  return toDateStringMX(toMXDate(raw));
}

/**
 * Si hay fecha de vencimiento, solo cuenta para semáforos cuando es >= ancla del proyecto.
 * Sin fecha: true (la UI usa la rama «sin fecha»).
 */
export function complianceDueDateIsActionable(dueDate: string | null | undefined, anchorYmd: string): boolean {
  if (dueDate == null || String(dueDate).trim() === "") return true;
  return dueDate >= anchorYmd;
}

/**
 * Días de calendario hasta la fecha de vencimiento (negativo = ya pasó). Basado en calendario local del Date MX.
 */
export function complianceCalendarDaysFromToday(dueYmd: string, todayMx: Date): number {
  const d = toMXDate(dueYmd);
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const t0 = new Date(todayMx.getFullYear(), todayMx.getMonth(), todayMx.getDate()).getTime();
  return Math.round((d0 - t0) / 86400000);
}

/**
 * Indica si una ocurrencia generada desde plantilla debe crearse para este proyecto.
 */
export function shouldIncludeComplianceOccurrence(
  dueDate: string,
  period: string,
  periodicity: string,
  anchorYmd: string,
): boolean {
  const p = (periodicity || "").toLowerCase();
  if (p === "cuando_aplique") {
    const anchorYear = parseInt(anchorYmd.slice(0, 4), 10);
    const m = /^(\d{4})$/.exec(period.trim());
    if (m) return parseInt(m[1], 10) >= anchorYear;
    return true;
  }
  if (!dueDate) return true;
  return dueDate >= anchorYmd;
}
