/** Mapeo de facturas del espejo local (portal-api) a filas de UI de diseño. */
import type { InvoiceRow } from "../design/types";
import { callApi } from "./api";
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
}

export async function listMirrorInvoices(
  clientId: string,
  direction: "emitida" | "recibida",
): Promise<MirrorCfdi[]> {
  const data = await callApi<{ facturas: MirrorCfdi[] }>("facturas.listar", {
    client_id: clientId,
    direction,
    filters: {},
  });
  return data.facturas ?? [];
}

export function toInvoiceRows(rows: MirrorCfdi[], direction: "emitida" | "recibida"): InvoiceRow[] {
  return rows.slice(0, 20).map((c) => {
    const party = direction === "emitida"
      ? (c.nombre_receptor ?? c.rfc_receptor ?? "—")
      : (c.nombre_emisor ?? c.rfc_emisor ?? "—");
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

export function rankParties(rows: MirrorCfdi[], direction: "emitida" | "recibida", limit = 4) {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const r of rows) {
    const name = direction === "emitida"
      ? (r.nombre_receptor ?? r.rfc_receptor ?? "Otros")
      : (r.nombre_emisor ?? r.rfc_emisor ?? "Otros");
    const cur = map.get(name) ?? { name, amount: 0, count: 0 };
    cur.amount += Number(r.total ?? 0);
    cur.count += 1;
    map.set(name, cur);
  }
  const sorted = [...map.values()].sort((a, b) => b.amount - a.amount);
  const top = sorted.slice(0, limit);
  const total = sorted.reduce((a, b) => a + b.amount, 0) || 1;
  return top.map((t) => ({
    name: t.name,
    amount: t.amount,
    share: Math.round((t.amount / total) * 100),
    meta: `${t.count} factura${t.count === 1 ? "" : "s"} · ${fmtMoney(t.amount)}`,
  }));
}
