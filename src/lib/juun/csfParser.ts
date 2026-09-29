import { C_REGIMEN_FISCAL } from "@/lib/juun/satCatalogs";

export interface CsfExtractedData {
  rfc?: string;
  razon_social?: string;
  cp_fiscal?: string;
  regimen_fiscal?: string;
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase();

const valueAfterLabel = (text: string, label: RegExp, nextLabel: RegExp) => {
  const match = text.match(new RegExp(`(?:${label.source})\\s*:?\\s*(.+?)(?=\\s+(?:${nextLabel.source})\\s*:|$)`, "is"));
  return match?.[1]?.replace(/\s+/g, " ").trim();
};

const regimenScore = (candidate: string, description: string) => {
  const words = new Set(normalize(candidate).split(" ").filter((word) => word.length > 2));
  const expected = normalize(description).split(" ").filter((word) => word.length > 2);
  return expected.length ? expected.filter((word) => words.has(word)).length / expected.length : 0;
};

export function parseCsfText(text: string): CsfExtractedData {
  const compact = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const rfc = valueAfterLabel(compact, /RFC/, /Denominaci[oó]n\/Raz[oó]n Social|Nombre|R[eé]gimen Capital/)
    ?.match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/i)?.[0]
    ?.toUpperCase();
  const razonSocial = valueAfterLabel(
    compact,
    /Denominaci[oó]n\/Raz[oó]n Social|Nombre \(s\)|Primer Apellido/,
    /R[eé]gimen Capital|Nombre Comercial|Segundo Apellido|Fecha inicio/
  );
  const cp = compact.match(/C[oó]digo Postal\s*:\s*(\d{5})/i)?.[1];
  const regimenSection = compact.match(/Reg[ií]menes\s*:\s*(.+?)(?=Obligaciones\s*:|Sus datos personales|Cadena Original|$)/is)?.[1] ?? "";
  const explicitCode = regimenSection.match(/\b(6\d{2})\b/)?.[1];
  const exactRegimen = explicitCode && C_REGIMEN_FISCAL.some((item) => item.clave === explicitCode) ? explicitCode : undefined;
  const closestRegimen = C_REGIMEN_FISCAL
    .map((item) => ({ clave: item.clave, score: regimenScore(regimenSection, item.descripcion) }))
    .sort((a, b) => b.score - a.score)[0];
  const regimen = exactRegimen ?? (closestRegimen?.score >= 0.6 ? closestRegimen.clave : undefined);

  return {
    ...(rfc ? { rfc } : {}),
    ...(razonSocial ? { razon_social: razonSocial } : {}),
    ...(cp ? { cp_fiscal: cp } : {}),
    ...(regimen ? { regimen_fiscal: regimen } : {}),
  };
}
