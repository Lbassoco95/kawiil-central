import type { LucideIcon } from "lucide-react";
import {
  FileBadge,
  FileCheck2,
  Inbox,
  Megaphone,
  ShieldAlert,
} from "lucide-react";

/** Tipos de consulta SAT vía SATgo (mismo set para todos los clientes). */
export type SatgoConsultType =
  | "lista_69b"
  | "constancia_situacion_fiscal"
  | "opinion_cumplimiento"
  | "buzon_comunicados"
  | "buzon_notificaciones";

export const SATGO_CONSULT_TYPES: SatgoConsultType[] = [
  "lista_69b",
  "constancia_situacion_fiscal",
  "opinion_cumplimiento",
  "buzon_comunicados",
  "buzon_notificaciones",
];

export const SATGO_CONSULT_META: Record<
  SatgoConsultType,
  { label: string; short: string; icon: LucideIcon; needsFiel: boolean }
> = {
  lista_69b: {
    label: "Lista 69-B",
    short: "69-B",
    icon: ShieldAlert,
    needsFiel: false,
  },
  constancia_situacion_fiscal: {
    label: "Constancia de situación fiscal",
    short: "CSF",
    icon: FileBadge,
    needsFiel: true,
  },
  opinion_cumplimiento: {
    label: "Opinión de cumplimiento 32D",
    short: "32D",
    icon: FileCheck2,
    needsFiel: true,
  },
  buzon_comunicados: {
    label: "Buzón · Comunicados",
    short: "Comunicados",
    icon: Megaphone,
    needsFiel: true,
  },
  buzon_notificaciones: {
    label: "Buzón · Notificaciones",
    short: "Notificaciones",
    icon: Inbox,
    needsFiel: true,
  },
};

export function satgoConsultLabel(consultType: string): string {
  return SATGO_CONSULT_META[consultType as SatgoConsultType]?.label ?? consultType;
}

export function satgoConsultShort(consultType: string): string {
  return SATGO_CONSULT_META[consultType as SatgoConsultType]?.short ?? consultType;
}
