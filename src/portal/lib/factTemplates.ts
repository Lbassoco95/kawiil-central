/**
 * Persistencia local (diseño / fallback) de clientes, conceptos y montos
 * para el wizard de Facturación. En auth se usa portal-api + tablas OS.
 */
export type SavedCustomer = {
  internal_id: string;
  label: string;
  rfc: string;
  nombre: string;
  regimen: string;
  cp: string;
  uso_cfdi: string;
  email?: string;
};

export type SavedConcept = {
  internal_id: string;
  label: string;
  descripcion: string;
  clave_prod_serv: string;
  clave_unidad: string;
  cantidad: number;
  valor_unitario: number;
  objeto_imp: "01" | "02";
  iva_tasa?: 0.16 | 0.08 | 0;
};

const CUST_KEY = "kawiil-os-fact-customers-v1";
const CONC_KEY = "kawiil-os-fact-concepts-v1";

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, rows: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(rows.slice(0, 80)));
  } catch { /* ignore */ }
}

export function loadLocalCustomers(): SavedCustomer[] {
  return read<SavedCustomer>(CUST_KEY);
}

export function saveLocalCustomer(c: SavedCustomer) {
  const prev = loadLocalCustomers().filter((x) => x.internal_id !== c.internal_id);
  write(CUST_KEY, [c, ...prev]);
}

export function loadLocalConcepts(): SavedConcept[] {
  return read<SavedConcept>(CONC_KEY);
}

export function saveLocalConcept(c: SavedConcept) {
  const prev = loadLocalConcepts().filter((x) => x.internal_id !== c.internal_id);
  write(CONC_KEY, [c, ...prev]);
}

export function autoInternalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36).slice(-6)}`;
}
