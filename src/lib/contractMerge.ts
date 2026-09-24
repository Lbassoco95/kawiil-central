/**
 * Merge determinístico de plantillas con placeholders [TOKEN].
 * Sin LLM en cláusulas (D6 / D10).
 */

export type TokenMap = Record<string, string | number | boolean | null | undefined>;

/** Escapa HTML básico para valores inyectados. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Reemplaza todas las ocurrencias de [TOKEN] en el body.
 * Tokens más largos primero para evitar solapamientos parciales.
 */
export function mergeTokens(body: string, values: TokenMap, opts?: { escape?: boolean }): string {
  const escape = opts?.escape !== false;
  const entries = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const token = k.startsWith("[") ? k : `[${k}]`;
      const raw = typeof v === "boolean" ? (v ? "SÍ" : "NO") : String(v);
      return [token, escape ? escapeHtml(raw) : raw] as const;
    })
    .sort((a, b) => b[0].length - a[0].length);

  let out = body;
  for (const [token, val] of entries) {
    if (!token || token === "[]") continue;
    out = out.split(token).join(val);
  }
  return out;
}

/**
 * Construye el mapa de tokens a partir de answers + fields del manifiesto.
 * Cada field declara `placeholder_in_body` (ej. [RFC]) y `field_key` (ej. client.rfc).
 */
export function buildTokenMapFromAnswers(
  answers: TokenMap,
  fields: Array<{ field_key: string; placeholder_in_body: string }>,
): TokenMap {
  const map: TokenMap = { ...answers };
  for (const f of fields) {
    const v = answers[f.field_key];
    if (v !== undefined && v !== null && String(v).length > 0) {
      const ph = f.placeholder_in_body.replace(/^\[/, "").replace(/\]$/, "");
      map[ph] = v;
      map[f.placeholder_in_body] = v;
    }
  }
  // Aliases frecuentes del inventario Backoffice / Softlanding
  const aliases: Record<string, string[]> = {
    "client.legal_name": ["DENOMINACIÓN O RAZÓN SOCIAL"],
    "client.rfc": ["RFC"],
    "client.domicilio_fiscal": ["DOMICILIO FISCAL"],
    "client.representante": ["NOMBRE DEL REPRESENTANTE"],
    "client.escritura": ["NÚMERO DE ESCRITURA"],
    "client.notaria": ["NOTARÍA Y FEDATARIO"],
    "client.folio_mercantil": ["FOLIO MERCANTIL ELECTRÓNICO"],
    "client.instrumento": ["INSTRUMENTO DEL QUE DERIVAN SUS FACULTADES"],
    "client.lfpiorpi": ["SÍ / NO"],
    "client.email": ["CORREO CLIENTE"],
    "firma.fecha": ["DD/MM/AAAA"],
    "firma.lugar": ["CIUDAD DE MÉXICO, MÉXICO"],
    "plan_name": ["PLAN NOMBRE"],
    "plan_id": ["PLAN CÓDIGO"],
    "list_price": ["MONTO LISTA"],
    "net_price": ["MONTO"],
    "discount_label": ["DESCUENTO"],
    "payment_method": ["FORMA DE PAGO"],
    "authorized_persons": ["PERSONAS AUTORIZADAS"],
    "services.labeled": ["SERVICIOS CONTRATADOS"],
    "sociedad.denominacion_1": ["OPCIÓN 1"],
    "sociedad.denominacion_2": ["OPCIÓN 2"],
    "sociedad.denominacion_3": ["OPCIÓN 3"],
    "sociedad.tipo": ["TIPO SOCIETARIO"],
    "sociedad.capital": ["CAPITAL"],
    "sociedad.objeto": ["OBJETO SOCIAL"],
    "sociedad.domicilio": ["DOMICILIO SOCIAL"],
    "sociedad.orgao_admin": ["ORGANO ADMIN"],
    "sociedad.admin_nombres": ["ADMIN NOMBRES"],
    "sociedad.tendra_trabajadores": ["SÍ / NO"],
    "sociedad.max_trabajadores": ["NÚMERO"],
    "fees.constitucion": ["FEE CONSTITUCION"],
    "fees.recurrente_usd": ["FEE RECURRENTE"],
  };
  for (const [key, tokens] of Object.entries(aliases)) {
    const v = answers[key];
    if (v === undefined || v === null || String(v).length === 0) continue;
    for (const t of tokens) {
      map[t] = v;
      map[`[${t}]`] = v;
    }
  }
  return map;
}

/** Descarga un Blob como archivo en el navegador. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadHtmlDocument(filename: string, html: string) {
  downloadBlob(filename, new Blob([html], { type: "text/html;charset=utf-8" }));
}

/** Abre el HTML merged en una ventana para imprimir / Guardar como PDF. */
export function openPrintPreview(html: string) {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Dar tiempo al layout antes de print
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  }, 350);
  return true;
}

export function formatMoneyMx(n: number | string | null | undefined): string {
  const num = typeof n === "string" ? Number(n) : n;
  if (num == null || Number.isNaN(Number(num))) return "";
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(Number(num));
}
