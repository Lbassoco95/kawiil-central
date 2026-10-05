/** Lectura del espejo local (portal-api) + reexport de mapeo a UI. */
import { callApi } from "./api";
import type { MirrorCfdi } from "./mirrorInvoiceMap";

export type { MirrorCfdi } from "./mirrorInvoiceMap";
export {
  mirrorSourceNote,
  partyName,
  rankParties,
  sumTotals,
  toInvoiceRows,
} from "./mirrorInvoiceMap";

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
