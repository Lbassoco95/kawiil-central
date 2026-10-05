/** Helpers puros: CFDI del espejo → filas/rankings de UI (sin client Supabase). */
import type { InvoiceRow } from "../design/types";
import { fmtDate, fmtMoney } from "./format";

export interface MirrorCfdi {
  id: string;
  uuid: string;
  direction: "emitida" | "recibida";
  fecha: string | null;
  rfc_emisor: string | null;
  nombre_emisor: string | null;
  rfc_receptor: string | null;
  nombre_receptor: string | null;
  total: number | null;
  sat_status: string;
  category_name: string | null;
  category_status: string;
  is_test: boolean;
  /** Origen de publicación en OS (p. ej. satgo_facfiel, central_mirror). */
  source?: string | null;
}

function shortUuid(uuid: string | null | undefined): string {
  if (!uuid) return "sin UUID";
  return `${uuid.slice(0, 8)}…`;
}

/** Contraparte legible aunque SatGo solo haya publicado metadatos (nombre/RFC nulos). */
export function partyName(row: MirrorCfdi, direction: "emitida" | "recibida"): string {
  if (direction === "emitida") {
    return row.nombre_receptor ?? row.rfc_receptor ?? `UUID ${shortUuid(row.uuid)}`;
  }
  return row.nombre_emisor ?? row.rfc_emisor ?? `UUID ${shortUuid(row.uuid)}`;
}

export function toInvoiceRows(rows: MirrorCfdi[], direction: "emitida" | "recibida"): InvoiceRow[] {
  return rows.slice(0, 20).map((c) => {
    const party = partyName(c, direction);
    const rfc = direction === "emitida" ? (c.rfc_receptor ?? "") : (c.rfc_emisor ?? "");
    const status: InvoiceRow["status"] = c.sat_status === "cancelado" ? "cancelado" : "vigente";
    return {
      date: c.fecha ? fmtDate(c.fecha) : "—",
      party,
      rfc,
      folio: c.uuid,
      total: Number(c.total ?? 0),
      status,
      proposal: c.category_name
        ? {
            account: c.category_name,
            code: "",
            status: c.category_status === "confirmada" ? "confirmada" : c.category_status === "sugerida" ? "sugerida" : "revisar",
          }
        : undefined,
    };
  });
}

export function sumTotals(rows: MirrorCfdi[]): number {
  return rows.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
}

export function mirrorSourceNote(rows: MirrorCfdi[]): string {
  const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))] as string[];
  if (sources.includes("satgo_facfiel")) return "publicado SatGo (satgo_facfiel)";
  if (sources.length) return `origen ${sources.join(", ")}`;
  return "espejo local portal_cfdi";
}

export function rankParties(rows: MirrorCfdi[], direction: "emitida" | "recibida", limit = 4) {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const r of rows) {
    const name = partyName(r, direction);
    const cur = map.get(name) ?? { name, amount: 0, count: 0 };
    cur.amount += Number(r.total ?? 0);
    cur.count += 1;
    map.set(name, cur);
  }
  const values = [...map.values()];
  const amountTotal = values.reduce((a, b) => a + b.amount, 0);
  const rankByCount = amountTotal === 0;
  const sorted = values.sort((a, b) => (rankByCount ? b.count - a.count : b.amount - a.amount));
  const top = sorted.slice(0, limit);
  const shareBase = rankByCount
    ? sorted.reduce((a, b) => a + b.count, 0) || 1
    : amountTotal || 1;
  return top.map((t) => ({
    name: t.name,
    amount: t.amount,
    share: Math.round(((rankByCount ? t.count : t.amount) / shareBase) * 100),
    meta: rankByCount
      ? `${t.count} factura${t.count === 1 ? "" : "s"} · monto no publicado en metadatos`
      : `${t.count} factura${t.count === 1 ? "" : "s"} · ${fmtMoney(t.amount)}`,
  }));
}
