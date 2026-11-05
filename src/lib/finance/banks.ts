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
