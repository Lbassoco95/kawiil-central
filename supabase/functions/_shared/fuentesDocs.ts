// Fuentes de documentos de un agente (Google Drive / Microsoft / Dropbox de clientes): piezas puras compartidas por la función
// `agente-constructor` (acción `fuentes_documentos`) y las pruebas. Se guardan en `config.fuentes_docs`; la VM
// (kawiil-agents/server/docs_sources.py) lee solo dentro de la carpeta raíz de cada fuente, en solo lectura.
// Aquí solo se guardan identificadores: ninguna credencial pasa por Kawiil.

export type ProveedorDocs = "google" | "microsoft" | "dropbox";
export interface FuenteDocs { proveedor: ProveedorDocs; etiqueta: string; carpeta_id: string; drive_id?: string; tenant_id?: string }
export type ResultadoFuentes = { ok: true; fuentes: FuenteDocs[] } | { ok: false; errores: string[] };
export const MAX_FUENTES_DOCS = 10;

const ID = /^[A-Za-z0-9_\-!]{5,200}$/;                       // ids de Drive y de Graph
// Dropbox: la fuente es siempre la carpeta de clientes que el puente autoriza («raiz»); un id de Dropbox solo sirve para acotarla a una subcarpeta.
const ID_DROPBOX = /^id:[A-Za-z0-9_\-]{5,200}$/;
const TENANT = /^([0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}|[A-Za-z0-9.\-]{3,100}\.[A-Za-z]{2,})$/;
const t = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

// De un enlace de carpeta de Drive (…/folders/<id>?…, …?id=<id>) o un id suelto al id.
export function idDeEnlaceGoogle(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/\/folders\/([A-Za-z0-9_-]+)/) ?? s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : s;
}

export function validarFuentesDocs(raw: unknown): ResultadoFuentes {
  if (!Array.isArray(raw)) return { ok: false, errores: ["La lista de fuentes no es válida."] };
  if (raw.length > MAX_FUENTES_DOCS) return { ok: false, errores: [`Máximo ${MAX_FUENTES_DOCS} fuentes por agente.`] };
  const errores: string[] = [];
  const fuentes: FuenteDocs[] = [];
  const etiquetas = new Set<string>();
  const carpetas = new Set<string>();
  raw.forEach((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const n = i + 1;
    const etiqueta = t(o.etiqueta, 80);
    if (etiqueta.length < 2) { errores.push(`Fuente ${n}: falta el nombre (por ejemplo «Drive Vizum»).`); return; }
    if (etiquetas.has(etiqueta.toLowerCase())) { errores.push(`Fuente ${n}: el nombre «${etiqueta}» está repetido.`); return; }
    if (o.proveedor === "google") {
      const carpeta = idDeEnlaceGoogle(o.carpeta_id);
      if (!ID.test(carpeta)) { errores.push(`«${etiqueta}»: el enlace o id de la carpeta de Drive no es válido.`); return; }
      if (carpetas.has(`google:${carpeta}`)) { errores.push(`«${etiqueta}»: esa carpeta ya está en otra fuente.`); return; }
      etiquetas.add(etiqueta.toLowerCase()); carpetas.add(`google:${carpeta}`);
      fuentes.push({ proveedor: "google", etiqueta, carpeta_id: carpeta });
    } else if (o.proveedor === "microsoft") {
      const carpeta = t(o.carpeta_id, 200), drive = t(o.drive_id, 200), tenant = t(o.tenant_id, 100);
      if (!ID.test(carpeta) || !ID.test(drive)) { errores.push(`«${etiqueta}»: el drive_id y la carpeta_id de Microsoft no son válidos (obtenlos con docs_cli.py microsoft-enlace).`); return; }
      if (!TENANT.test(tenant)) { errores.push(`«${etiqueta}»: el tenant debe ser un GUID o un dominio como contoso.onmicrosoft.com.`); return; }
      if (carpetas.has(`microsoft:${drive}:${carpeta}`)) { errores.push(`«${etiqueta}»: esa carpeta ya está en otra fuente.`); return; }
      etiquetas.add(etiqueta.toLowerCase()); carpetas.add(`microsoft:${drive}:${carpeta}`);
      fuentes.push({ proveedor: "microsoft", etiqueta, carpeta_id: carpeta, drive_id: drive, tenant_id: tenant });
    } else if (o.proveedor === "dropbox") {
      const carpeta = t(o.carpeta_id, 210) || "raiz";
      if (carpeta !== "raiz" && !ID_DROPBOX.test(carpeta)) { errores.push(`«${etiqueta}»: la carpeta de Dropbox debe ser «raiz» o un id de Dropbox (id:…).`); return; }
      if (carpetas.has(`dropbox:${carpeta}`)) { errores.push(`«${etiqueta}»: esa carpeta de Dropbox ya está en otra fuente.`); return; }
      etiquetas.add(etiqueta.toLowerCase()); carpetas.add(`dropbox:${carpeta}`);
      fuentes.push({ proveedor: "dropbox", etiqueta, carpeta_id: carpeta });
    } else {
      errores.push(`Fuente ${n}: proveedor no válido.`);
    }
  });
  return errores.length ? { ok: false, errores } : { ok: true, fuentes };
}
