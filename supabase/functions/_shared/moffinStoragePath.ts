/**
 * Objeto en bucket `documents`: organización / moffin / clientes / {clientId} / {año} / {mes} / archivo.pdf
 */
export function buildMoffinPdfStoragePath(
  orgId: string,
  clientId: string | null | undefined,
  fileBase: string,
  at: Date = new Date(),
): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const clientSeg = (clientId && String(clientId).trim()) || "sin_cliente";
  const safeBase = fileBase.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "documento";
  return `${orgId}/moffin/clientes/${clientSeg}/${y}/${m}/${Date.now()}_${safeBase}.pdf`;
}
