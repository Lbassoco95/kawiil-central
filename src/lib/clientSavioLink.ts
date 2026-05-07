import { pickSavioString } from "@/lib/savioApiNormalize";
import type { SavioCustomerRowView } from "@/hooks/useSavioFinanceApi";

export type ClientSavioLinkStatus =
  | "no_link"
  | "linked"
  | "rfc_suggest"
  | "rfc_mismatch";

export type ClientLikeForSavio = {
  id: string;
  name: string;
  rfc: string | null;
  savio_customer_id: string | null;
};

/** RFC para comparar: mayúsculas, sin espacios; vacío si no hay valor útil. */
export function normalizeRfcForCompare(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function extractSavioIdFromWriteData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const top = pickSavioString(data, ["id", "uuid", "customer_id"]);
  if (top !== "—") return top;
  const inner = (data as { data?: unknown }).data;
  if (inner && typeof inner === "object") {
    const id = pickSavioString(inner, ["id", "uuid", "customer_id"]);
    return id !== "—" ? id : null;
  }
  return null;
}

/** ID devuelto por POST /invoice (Savio/OpenAPI puede usar varias claves). */
export function extractSavioInvoiceIdFromWriteData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const top = pickSavioString(data, ["invoice_id", "charge_id", "id", "uuid"]);
  if (top !== "—") return top;
  const inner = (data as { data?: unknown }).data;
  if (inner && typeof inner === "object") {
    const id = pickSavioString(inner, ["invoice_id", "charge_id", "id", "uuid"]);
    return id !== "—" ? id : null;
  }
  return null;
}

/** Clientes Savio cuyo id no está enlazado en ningún cliente Kawiil de la org. */
export function savioCustomersMissingInKawiil(
  customerRows: SavioCustomerRowView[],
  kawiilClients: ClientLikeForSavio[],
): SavioCustomerRowView[] {
  const linked = new Set(
    kawiilClients.map((c) => c.savio_customer_id?.trim()).filter(Boolean) as string[],
  );
  return customerRows.filter((r) => {
    const id = r.id?.trim();
    if (!id || id.startsWith("c-")) return false;
    return !linked.has(id);
  });
}

/** Clientes Kawiil sin savio_customer_id pero cuyo RFC coincide con un Savio (sugerencia). */
export function findSavioCustomerIdsByRfc(
  rfcNorm: string,
  customerRows: SavioCustomerRowView[],
): string[] {
  if (!rfcNorm) return [];
  const out: string[] = [];
  for (const r of customerRows) {
    const sr = normalizeRfcForCompare(r.rfc);
    if (sr && sr === rfcNorm && r.id && !r.id.startsWith("c-")) out.push(r.id);
  }
  return [...new Set(out)];
}

export function clientSavioLinkStatus(
  client: ClientLikeForSavio,
  customerRows: SavioCustomerRowView[],
  /** Payload Savio del GET /customer/{id} tras reconciliar (opcional). */
  savioDetailPayload?: unknown,
): { status: ClientSavioLinkStatus; suggestedSavioIds: string[] } {
  const rfcNorm = normalizeRfcForCompare(client.rfc);
  const suggested = findSavioCustomerIdsByRfc(rfcNorm, customerRows);

  if (client.savio_customer_id?.trim()) {
    if (savioDetailPayload && typeof savioDetailPayload === "object") {
      const savioRfc = normalizeRfcForCompare(
        pickSavioString(savioDetailPayload, ["rfc", "tax_id", "taxId", "RFC"]),
      );
      if (rfcNorm && savioRfc && rfcNorm !== savioRfc) {
        return { status: "rfc_mismatch", suggestedSavioIds: suggested };
      }
    }
    return { status: "linked", suggestedSavioIds: suggested };
  }

  if (rfcNorm && suggested.length > 0) {
    return { status: "rfc_suggest", suggestedSavioIds: suggested };
  }

  return { status: "no_link", suggestedSavioIds: suggested };
}
