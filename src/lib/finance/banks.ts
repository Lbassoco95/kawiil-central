/**
 * Instituciones que operan por SPEI en México (referencia local; la lista oficial de Banxico es
 * https://www.banxico.org.mx/cep-scl/listaInstituciones.do). Si falta una, el campo acepta texto libre.
 */
export const BANKS: string[] = [
  "ABC Capital", "Actinver", "Afirme", "Albo", "American Express", "Autofin", "Azteca", "BanBajío", "Banca Mifel",
  "Banco del Bienestar", "Banco Famsa", "Banco Inmobiliario Mexicano", "Banco Multiva", "Banco Ve por Más", "Banamex (Citibanamex)",
  "Bancoppel", "Bankaool", "Banorte", "Banregio", "Bansí", "Barclays", "BBVA México", "Bbase", "Bitso", "CIBanco", "Compartamos Banco",
  "Consubanco", "Fondeadora", "Hey Banco", "HSBC", "ICBC", "Inbursa", "Intercam Banco", "Invex", "Klar", "Konfío",
  "Mercado Pago", "Monex", "Mizuho Bank", "MUFG Bank", "Nafin", "Nu México", "PagaTodo", "Revolut", "Santander", "Scotiabank",
  "Spin by OXXO", "Stori", "STP (Sistema de Transferencias y Pagos)", "Transfer", "Ualá", "Volkswagen Bank", "Efectivo (caja)",
];

export function bankSuggestion(institution: string): string {
  return institution.replace(/\s*\(.*\)\s*$/, "").trim();
}

export interface BankEntry { name: string; code: string | null }

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/**
 * Lee la lista de instituciones de Banxico (copiada de la página, CSV o Excel pegado).
 * Acepta «clave nombre», «nombre clave» o solo nombres, separados por tab, coma, punto y coma o espacios.
 * Las claves de 5 dígitos de Banxico (40012, 90646…) se reducen a su clave CLABE de 3 dígitos.
 */
export function parseBankList(text: string): BankEntry[] {
  const out = new Map<string, BankEntry>();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, " ").trim();
    if (!line || /^(clave|nombre|instituci[oó]n|participante|#)\b/i.test(line)) continue;
    const parts = line.split(/\t|;|\|/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) { const m = /^"?(\d{3,5})"?[\s,.-]+(.+)$/.exec(parts[0]) ?? /^(.+?)[\s,]+"?(\d{3,5})"?$/.exec(parts[0]); if (m) parts.splice(0, 1, ...(/^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]])); }
    let code: string | null = null; let name = "";
    for (const p of parts) {
      const c = p.replace(/^"|"$/g, "");
      if (/^\d{3,5}$/.test(c) && !code) code = c;
      else if (!name && /\p{L}/u.test(c)) name = c;
    }
    if (!name) { line = parts.join(" "); if (!/\p{L}/u.test(line)) continue; name = line; }
    if (code && code.length === 5) code = code.slice(-3);
    name = name.replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
    if (name === name.toUpperCase()) name = titleCase(name);
    if (name.length < 2 || name.length > 90) continue;
    out.set(name.toLowerCase(), { name, code });
  }
  return [...out.values()];
}

/** Catálogo = base local + lo cargado/creado por la organización (gana lo cargado). */
export function mergeBanks(stored: BankEntry[]): BankEntry[] {
  const map = new Map<string, BankEntry>();
  BANKS.forEach((n) => map.set(n.toLowerCase(), { name: n, code: null }));
  stored.forEach((b) => map.set(b.name.toLowerCase(), b));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
