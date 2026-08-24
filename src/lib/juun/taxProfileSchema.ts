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
  isRegimenFiscalValido,
  isUsoCfdiValido,
  getRegimenFiscal,
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
 * Advertencia NO bloqueante: un RFC de persona física con un régimen de
 * persona moral (o al revés) casi siempre es un dedazo, pero la palabra final
 * la tiene la CSF, no nosotros. Devuelve null si no hay nada que advertir.
 */
export function avisoPersonaVsRegimen(
  rfc: string,
  regimenClave: string
): string | null {
  const persona = tipoPersonaPorRfc(rfc);
  const regimen = getRegimenFiscal(regimenClave);
  if (!persona || !regimen || regimen.persona === "ambas") return null;
  if (regimen.persona === persona) return null;

  const comoRfc = persona === "fisica" ? "persona física" : "persona moral";
  const comoRegimen = regimen.persona === "fisica" ? "personas físicas" : "personas morales";
  return `El RFC es de ${comoRfc} y el régimen ${regimen.clave} es de ${comoRegimen}. Revísalo contra la CSF antes de guardar.`;
}

/** El texto que el usuario tiene que leer antes de guardar. No se recorta ni se esconde. */
export const AVISO_CSF =
  "Estos datos deben coincidir exactamente con la Constancia de Situación Fiscal vigente. " +
  "Cualquier diferencia —una abreviatura, el código postal comercial en vez del fiscal, un régimen " +
  "que ya cambió— hace que el comercio rechace la factura.";
