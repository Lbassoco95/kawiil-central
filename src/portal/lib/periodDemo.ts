import type { PeriodId } from "../design/types";
import { pushDemoToast } from "./demoStore";

const LABELS: Record<PeriodId, string[]> = {
  mes: ["Julio 2026", "Agosto 2026", "Septiembre 2026"],
  trimestre: ["T1 2026", "T2 2026", "T3 2026"],
  anio: ["2024", "2025", "2026"],
};

export function periodLabel(period: PeriodId, index: number) {
  const list = LABELS[period];
  const i = Math.max(0, Math.min(index, list.length - 1));
  return list[i];
}

export function clampPeriodIndex(period: PeriodId, index: number) {
  const list = LABELS[period];
  return Math.max(0, Math.min(index, list.length - 1));
}

export function notifyPeriod(label: string) {
  pushDemoToast({ tone: "info", text: `Periodo demo: ${label}` });
}
