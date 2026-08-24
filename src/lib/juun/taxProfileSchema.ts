/**
 * Validación del formulario de datos fiscales.
 *
 * Las mismas reglas están como CHECK en `fis_tax_profiles`: aquí para dar un
 * mensaje decente, allá para que nada entre mal aunque no pase por esta UI.
 */

import { z } from "zod";
import { validarRfc } from "@/lib/juun/rfc";
import {
  USO_CFDI_DEFAULT,
  getRegimenFiscal,
  isRegimenFiscalValido,
  isUsoCfdiValido,
  personaDelRegimen,
} from "@/lib/juun/satCatalogs";
import { tipoPersonaPorRfc } from "@/lib/juun/rfc";

export const taxProfileSchema = z.object({
  rfc: z
    .string()
    .trim()
    .superRefine((valor, ctx) => {
      const r = validarRfc(valor);
      if (!r.valido) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error ?? "RFC inválido." });
      }
    }),
  razon_social: z
    .string()
    .trim()
    .min(1, "Captura la razón social, exacta como está en la CSF.")
    .max(300, "La razón social es demasiado larga."),
  cp_fiscal: z
    .string()
    .trim()
    .regex(/^[0-9]{5}$/, "El código postal fiscal son 5 dígitos."),
  regimen_fiscal: z
    .string()
    .refine(isRegimenFiscalValido, "Elige un régimen fiscal del catálogo del SAT."),
  uso_cfdi_default: z
    .string()
    .refine(isUsoCfdiValido, "Elige un uso de CFDI del catálogo del SAT."),
  email_recepcion: z
    .string()
    .trim()
    .email("Correo inválido.")
    .or(z.literal(""))
    .optional(),
});

export type TaxProfileSchemaValues = z.infer<typeof taxProfileSchema>;

export const TAX_PROFILE_DEFAULTS: TaxProfileSchemaValues = {
  rfc: "",
  razon_social: "",
  cp_fiscal: "",
  regimen_fiscal: "",
  uso_cfdi_default: USO_CFDI_DEFAULT,
  email_recepcion: "",
};

/**
 * Advertencia NO bloqueante para el dedazo que de verdad ocurre: dejar 601
 * puesto —porque es el primero de la lista— en el perfil de una persona
 * física.
 *
 * Solo dispara con RFC de 13 caracteres y un régimen que sabemos de cierto
 * que es de persona moral (`REGIMENES_PERSONA_MORAL_CIERTOS`). En todo lo
 * demás calla, aunque "huela" mal: mientras el catálogo oficial no esté
 * cargado no tenemos con qué afirmarlo, y una advertencia que se equivoca es
 * peor que no advertir — la gente aprende a ignorarla.
 *
 * Devuelve null si no hay nada que advertir.
 */
export function avisoPersonaVsRegimen(
  rfc: string,
  regimenClave: string
): string | null {
  if (tipoPersonaPorRfc(rfc) !== "fisica") return null;
  if (personaDelRegimen(regimenClave) !== "moral") return null;

  const regimen = getRegimenFiscal(regimenClave);
  const nombre = regimen ? `${regimen.clave} (${regimen.descripcion})` : regimenClave;
  return `El RFC es de persona física y el régimen ${nombre} es de personas morales. Revísalo contra la CSF antes de guardar.`;
}

/** El texto que el usuario tiene que leer antes de guardar. No se recorta ni se esconde. */
export const AVISO_CSF =
  "Estos datos deben coincidir exactamente con la Constancia de Situación Fiscal vigente. " +
  "Cualquier diferencia —una abreviatura, el código postal comercial en vez del fiscal, un régimen " +
  "que ya cambió— hace que el comercio rechace la factura.";
