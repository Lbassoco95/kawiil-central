/**
 * Validaciones ANTES de emitir. Se corren en el navegador (para avisar) y,
 * de nuevo y con autoridad, en la Edge portal-api (para decidir).
 * Si falta cualquier dato obligatorio, no se emite.
 */
import {
  isCpFiscal,
  isFormaPago,
  isRegimen,
  isRfcFormat,
  isUsoCfdi,
  normalizeRfc,
  usoCompatibleConRegimen,
  C_REGIMEN_FISCAL,
  tipoPersona,
} from "../validate.ts";
import type { BorradorFactura, ContextoEmision, ErrorValidacion, ResultadoValidacion, Totales } from "./types.ts";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularTotales(b: BorradorFactura): Totales {
  let subtotal = 0;
  let iva = 0;
  for (const c of b.conceptos ?? []) {
    const importe = r2((Number(c.cantidad) || 0) * (Number(c.valorUnitario) || 0));
    subtotal += importe;
    if (c.objetoImp === "02" && typeof c.ivaTasa === "number") iva += r2(importe * c.ivaTasa);
  }
  subtotal = r2(subtotal);
  iva = r2(iva);
  return { subtotal, iva, total: r2(subtotal + iva) };
}

export function validarBorrador(b: BorradorFactura, ctx: ContextoEmision): ResultadoValidacion {
  const e: ErrorValidacion[] = [];
  const add = (campo: string, mensaje: string) => e.push({ campo, mensaje });
  const vacio = (v: unknown) => typeof v !== "string" || v.trim() === "";

  // Emisor (del perfil fiscal verificado).
  if (!b?.emisor) add("emisor", "Faltan los datos fiscales del emisor.");
  else {
    if (!isRfcFormat(b.emisor.rfc)) add("emisor.rfc", "El RFC del emisor no tiene un formato válido.");
    if (vacio(b.emisor.nombre)) add("emisor.nombre", "Falta la razón social del emisor.");
    if (!isRegimen(b.emisor.regimen)) add("emisor.regimen", "El régimen fiscal del emisor no está en el catálogo del SAT.");
    if (!isCpFiscal(b.emisor.cp)) add("emisor.cp", "El código postal fiscal del emisor debe tener 5 dígitos.");
  }

  // Receptor.
  const r = b?.receptor;
  if (!r) add("receptor", "Faltan los datos del receptor.");
  else {
    const rfc = normalizeRfc(r.rfc);
    if (!isRfcFormat(rfc)) {
      add("receptor.rfc", /^X[AE]XX010101000$/.test(rfc)
        ? "El portal no emite a RFC genérico (público en general o extranjero)."
        : "El RFC del receptor no tiene un formato válido.");
    }
    if (vacio(r.nombre)) add("receptor.nombre", "Falta el nombre o razón social del receptor, tal como aparece en su constancia.");
    if (!isCpFiscal(r.cp)) add("receptor.cp", "El código postal fiscal del receptor debe tener 5 dígitos.");
    if (!isRegimen(r.regimen)) add("receptor.regimen", "El régimen fiscal del receptor no está en el catálogo del SAT.");
    if (!isUsoCfdi(r.uso)) add("receptor.uso", "El uso de CFDI no está en el catálogo del SAT.");
    if (isRegimen(r.regimen) && isUsoCfdi(r.uso)) {
      const c = usoCompatibleConRegimen(r.uso, r.regimen, ctx?.matrizUsoRegimen);
      if (!c.ok) {
        add("receptor.uso", c.reason === "matriz_no_cargada"
          ? "No se puede verificar que el uso de CFDI corresponda al régimen del receptor: la matriz oficial del SAT no está cargada. La emisión queda bloqueada."
          : `El uso de CFDI ${r.uso} no es válido para el régimen ${r.regimen} del receptor.`);
      }
      const entry = C_REGIMEN_FISCAL.find((x) => x.clave === r.regimen);
      const persona = tipoPersona(rfc);
      if (entry && persona && typeof entry.fisica === "boolean" && typeof entry.moral === "boolean") {
        if ((persona === "fisica" && !entry.fisica) || (persona === "moral" && !entry.moral)) {
          add("receptor.regimen", `El régimen ${r.regimen} no aplica a una persona ${persona === "fisica" ? "física" : "moral"}.`);
        }
      }
    }
  }

  // Pago.
  if (!isFormaPago(b?.formaPago)) add("formaPago", "La forma de pago no está en el catálogo del SAT.");
  if (b?.metodoPago !== "PUE" && b?.metodoPago !== "PPD") add("metodoPago", "El método de pago debe ser PUE o PPD.");
  if (b?.metodoPago === "PPD" && b?.formaPago !== "99") add("formaPago", "Con pago en parcialidades o diferido (PPD) la forma de pago debe ser 99 «Por definir».");
  if (b?.metodoPago === "PUE" && b?.formaPago === "99") add("formaPago", "Con pago en una sola exhibición (PUE) indique la forma de pago real, no 99.");
  if (b?.moneda !== "MXN") add("moneda", "Por ahora el portal solo emite en pesos mexicanos (MXN).");

  // Conceptos.
  if (!Array.isArray(b?.conceptos) || b.conceptos.length === 0) add("conceptos", "Agregue al menos un concepto.");
  (b?.conceptos ?? []).forEach((c, i) => {
    const p = `conceptos[${i}]`;
    if (!/^\d{8}$/.test(c.claveProdServ ?? "")) add(`${p}.claveProdServ`, "La clave de producto o servicio debe tener 8 dígitos.");
    if (vacio(c.claveUnidad)) add(`${p}.claveUnidad`, "Falta la clave de unidad.");
    if (vacio(c.descripcion)) add(`${p}.descripcion`, "Falta la descripción.");
    if (!(Number(c.cantidad) > 0)) add(`${p}.cantidad`, "La cantidad debe ser mayor a cero.");
    if (!(Number(c.valorUnitario) >= 0)) add(`${p}.valorUnitario`, "El valor unitario no puede ser negativo.");
    if (c.objetoImp !== "01" && c.objetoImp !== "02") add(`${p}.objetoImp`, "Indique si el concepto es objeto de impuesto.");
    if (c.objetoImp === "02" && ![0.16, 0.08, 0].includes(c.ivaTasa as number)) add(`${p}.ivaTasa`, "La tasa de IVA debe ser 16 %, 8 % o 0 %.");
  });

  // Certificado del emisor.
  const ahora = ctx?.ahora ?? new Date();
  if (!ctx?.omitirCsd) {
    if (!ctx?.csd) add("csd", "No hay certificado de sello digital cargado.");
    else if (ctx.csd.revoked) add("csd", "El certificado de sello digital fue revocado.");
    else if (!ctx.csd.notAfter || new Date(ctx.csd.notAfter) <= ahora) add("csd", "El certificado de sello digital está vencido.");
    else if (ctx.csd.notBefore && new Date(ctx.csd.notBefore) > ahora) add("csd", "El certificado de sello digital aún no es vigente.");
  }

  const totales = calcularTotales(b ?? ({ conceptos: [] } as unknown as BorradorFactura));
  if (totales.total <= 0 && e.length === 0) add("total", "El total de la factura debe ser mayor a cero.");
  return { ok: e.length === 0, errores: e, totales };
}
