/**
 * Lee el catálogo oficial del SAT (catCFDI_V_4_*.xls, «Formato de factura
 * (Anexo 20)») y produce c_RegimenFiscal, c_UsoCFDI, c_FormaPago y la matriz
 * c_UsoCFDI × Régimen Fiscal Receptor. Nada se captura a mano.
 */
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Filas de una hoja a partir del renglón cuyo primer valor es el nombre del catálogo. */
function sheetRows(XLSX, wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`El archivo no trae la hoja ${name}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const h = rows.findIndex((r) => norm(r[0]) === norm(name));
  if (h < 0) throw new Error(`No se encontró el encabezado de ${name}`);
  const header = rows[h].map(norm);
  const col = (...alts) => header.findIndex((c) => alts.some((a) => c.includes(a)));
  return { header, col, rows: rows.slice(h + 1).filter((r) => String(r[0]).trim() !== "") };
}

const siNo = (v) => /^s[ií]?$/i.test(String(v).trim());
const vigente = (fin) => {
  if (fin === "" || fin == null) return true;
  const d = typeof fin === "number" ? new Date(Math.round((fin - 25569) * 86400000)) : new Date(fin);
  return Number.isNaN(d.getTime()) || d > new Date();
};

export function parseSatWorkbook(XLSX, wb, sourceName) {
  const meta = (catalogo) => ({
    catalogo,
    fuente: sourceName,
    publicado: (sourceName.match(/(\d{8})/) || [])[1] ?? null,
    generado_por: "tools/portal/build-sat-catalogs.mjs",
  });

  const reg = sheetRows(XLSX, wb, "c_RegimenFiscal");
  const cF = reg.col("fisica"), cM = reg.col("moral"), cFin = reg.col("fin de vigencia");
  const regimen = reg.rows
    .filter((r) => cFin < 0 || vigente(r[cFin]))
    .map((r) => ({ clave: String(r[0]).trim(), descripcion: String(r[1]).trim(), fisica: siNo(r[cF]), moral: siNo(r[cM]) }));

  const uso = sheetRows(XLSX, wb, "c_UsoCFDI");
  const uFin = uso.col("fin de vigencia");
  const uReg = uso.col("regimen fiscal receptor");
  if (uReg < 0) throw new Error("c_UsoCFDI no trae la columna «Régimen Fiscal Receptor»");
  const usos = uso.rows.filter((r) => uFin < 0 || vigente(r[uFin]));
  const usoEntries = usos.map((r) => ({ clave: String(r[0]).trim(), descripcion: String(r[1]).trim() }));
  const compat = usos.map((r) => ({
    uso: String(r[0]).trim(),
    regimenes: String(r[uReg]).split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^\d{3}$/.test(x)),
  }));

  const fp = sheetRows(XLSX, wb, "c_FormaPago");
  const fFin = fp.col("fin de vigencia");
  const formaPago = fp.rows
    .filter((r) => fFin < 0 || vigente(r[fFin]))
    .map((r) => ({ clave: String(r[0]).trim().padStart(2, "0"), descripcion: String(r[1]).trim() }));

  return {
    c_RegimenFiscal: { _meta: meta("c_RegimenFiscal"), entries: regimen },
    c_UsoCFDI: { _meta: meta("c_UsoCFDI"), entries: usoEntries },
    c_FormaPago: { _meta: meta("c_FormaPago"), entries: formaPago },
    c_UsoCFDI_RegimenReceptor: {
      _meta: { ...meta("c_UsoCFDI × c_RegimenFiscal (columna «Régimen Fiscal Receptor» de c_UsoCFDI)") },
      entries: compat,
    },
  };
}
