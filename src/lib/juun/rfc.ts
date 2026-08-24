/**
 * Validación de RFC para los perfiles fiscales de Ju'un.
 *
 * El mismo formato se valida en la base (CHECK en `fis_tax_profiles.rfc`), así
 * que un RFC mal formado no entra ni por la UI ni por un script.
 *
 * Estructura: 3 letras (moral) o 4 (física) + fecha AAMMDD + homoclave de 3.
 * No verificamos que el RFC exista ante el SAT: eso no se puede hacer sin
 * consultar al SAT, y para eso ya está `csf_verified_at` (revisión humana
 * contra la Constancia de Situación Fiscal).
 */

export type TipoPersonaRfc = "fisica" | "moral";

/** RFC genéricos: válidos en un CFDI como emisor/receptor especial, nunca como el RFC propio de un cliente. */
export const RFC_GENERICOS = ["XAXX010101000", "XEXX010101000"] as const;

const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/** Quita espacios, guiones y acentos de captura, y pasa a mayúsculas. */
export function normalizarRfc(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/[\s.-]/g, "")
    .toUpperCase();
}

/** ¿La parte AAMMDD del RFC es una fecha que existe? Atrapa dedazos como 850230 o 851301. */
function fechaValida(aammdd: string): boolean {
  const anio = Number(aammdd.slice(0, 2));
  const mes = Number(aammdd.slice(2, 4));
  const dia = Number(aammdd.slice(4, 6));
  if (mes < 1 || mes > 12 || dia < 1) return false;

  // El RFC no lleva siglo. Para contar días de febrero probamos ambos siglos y
  // aceptamos si el día cabe en alguno: un 29/02 puede ser 1996 o 2096.
  const cabeEn = (siglo: number) =>
    dia <= new Date(Date.UTC(siglo + anio, mes, 0)).getUTCDate();
  return cabeEn(1900) || cabeEn(2000);
}

export function tipoPersonaPorRfc(rfc: string): TipoPersonaRfc | null {
  const n = normalizarRfc(rfc);
  if (n.length === 12) return "moral";
  if (n.length === 13) return "fisica";
  return null;
}

export function esRfcGenerico(rfc: string | null | undefined): boolean {
  const n = normalizarRfc(rfc);
  return (RFC_GENERICOS as readonly string[]).includes(n);
}

export interface ResultadoRfc {
  valido: boolean;
  rfc: string;
  tipoPersona: TipoPersonaRfc | null;
  /** Mensaje listo para mostrar; null si el RFC está bien. */
  error: string | null;
}

export function validarRfc(raw: string | null | undefined): ResultadoRfc {
  const rfc = normalizarRfc(raw);
  const base: ResultadoRfc = { valido: false, rfc, tipoPersona: null, error: null };

  if (!rfc) return { ...base, error: "Captura el RFC." };

  if (rfc.length !== 12 && rfc.length !== 13) {
    return {
      ...base,
      error: `El RFC tiene ${rfc.length} caracteres: son 12 para persona moral y 13 para persona física.`,
    };
  }

  if (!RFC_RE.test(rfc)) {
    return {
      ...base,
      error: "Formato inválido: letras iniciales, fecha AAMMDD y homoclave de 3 caracteres.",
    };
  }

  const letras = rfc.length === 12 ? 3 : 4;
  if (!fechaValida(rfc.slice(letras, letras + 6))) {
    return { ...base, error: "La fecha dentro del RFC no existe. Revisa los seis dígitos de en medio." };
  }

  if (esRfcGenerico(rfc)) {
    return {
      ...base,
      tipoPersona: tipoPersonaPorRfc(rfc),
      error:
        "Ese es el RFC genérico de público en general; no sirve para facturar a nombre del cliente. Captura su RFC propio.",
    };
  }

  return { valido: true, rfc, tipoPersona: tipoPersonaPorRfc(rfc), error: null };
}

export function esRfcValido(raw: string | null | undefined): boolean {
  return validarRfc(raw).valido;
}

/** Código postal fiscal: exactamente 5 dígitos. */
export function esCpValido(raw: string | null | undefined): boolean {
  return /^[0-9]{5}$/.test((raw ?? "").trim());
}
