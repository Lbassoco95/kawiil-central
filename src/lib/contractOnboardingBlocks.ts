import type { ContractPackageKind } from "@/types/contracts";

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  fields: string[];
}

/** Bloques Typeform-ish por proceso (MVP). Campos alineados al manifiesto. */
export function wizardStepsFor(kind: ContractPackageKind): WizardStep[] {
  if (kind === "backoffice_pm") {
    return [
      {
        id: "welcome",
        title: "Contrato de Backoffice",
        description: "Vamos a reunir los datos de la carátula. Tú y el equipo Kawiil ven la misma información.",
        fields: [],
      },
      {
        id: "identity",
        title: "Datos de la empresa",
        description: "Razón social, RFC y domicilio fiscal.",
        fields: [
          "client.legal_name",
          "client.rfc",
          "client.domicilio_fiscal",
          "client.representante",
          "client.instrumento",
          "client.email",
        ],
      },
      {
        id: "constitucion_docs",
        title: "Datos societarios",
        description: "Escritura, notaría y folio (si ya los tienes).",
        fields: ["client.escritura", "client.notaria", "client.folio_mercantil", "client.lfpiorpi"],
      },
      {
        id: "plan",
        title: "Plan y honorarios",
        description: "Elige el plan del catálogo. Puedes aplicar descuento o ajustar el neto.",
        fields: ["plan_id", "list_price", "discount_amount", "net_price", "payment_method"],
      },
      {
        id: "ops",
        title: "Operación",
        description: "Forma de pago y personas autorizadas.",
        fields: ["authorized_persons", "services.labeled", "firma.fecha", "firma.lugar"],
      },
      {
        id: "summary",
        title: "Resumen",
        description: "Revisa antes de generar el documento para firma externa.",
        fields: [],
      },
    ];
  }

  return [
    {
      id: "welcome",
      title: "Contrato marco Softlanding",
      description: "Capturamos Anexo A Sección 1. Los anexos B/C/D se emiten después, durante el servicio.",
      fields: [],
    },
    {
      id: "identity",
      title: "Contacto",
      description:
        "Datos de contacto. El RFC es opcional en Softlanding (muchas sociedades aún se están constituyendo).",
      fields: ["client.legal_name", "client.representante", "client.email", "client.rfc"],
    },
    {
      id: "sociedad",
      title: "Sociedad en constitución",
      fields: [
        "sociedad.denominacion_1",
        "sociedad.denominacion_2",
        "sociedad.denominacion_3",
        "sociedad.tipo",
        "sociedad.capital",
        "sociedad.objeto",
        "sociedad.domicilio",
      ],
    },
    {
      id: "admin",
      title: "Administración y fees",
      fields: [
        "sociedad.orgao_admin",
        "sociedad.admin_nombres",
        "sociedad.tendra_trabajadores",
        "sociedad.max_trabajadores",
        "fees.constitucion",
        "fees.recurrente_usd",
        "firma.fecha",
        "firma.lugar",
      ],
    },
    {
      id: "summary",
      title: "Resumen",
      description: "Anexos C/D quedan pendientes post-firma (D11).",
      fields: [],
    },
  ];
}

export const FIELD_LABELS: Record<string, string> = {
  "client.legal_name": "Denominación o razón social",
  "client.rfc": "RFC",
  "client.domicilio_fiscal": "Domicilio fiscal",
  "client.representante": "Representante legal",
  "client.instrumento": "Instrumento de facultades",
  "client.email": "Correo de contacto",
  "client.escritura": "Número de escritura",
  "client.notaria": "Notaría y fedatario",
  "client.folio_mercantil": "Folio mercantil electrónico",
  "client.lfpiorpi": "¿Actividad vulnerable LFPIORPI? (SÍ / NO)",
  "client.phone": "Teléfono",
  plan_id: "Plan Backoffice",
  list_price: "Precio de lista (MXN / mes)",
  discount_amount: "Descuento (MXN)",
  net_price: "Precio neto (MXN / mes)",
  payment_method: "Forma de pago",
  authorized_persons: "Personas autorizadas (Nombre—correo)",
  "services.labeled": "Servicios contratados",
  "firma.fecha": "Fecha del contrato (DD/MM/AAAA)",
  "firma.lugar": "Lugar",
  "sociedad.denominacion_1": "Denominación opción 1",
  "sociedad.denominacion_2": "Denominación opción 2",
  "sociedad.denominacion_3": "Denominación opción 3",
  "sociedad.tipo": "Tipo societario",
  "sociedad.capital": "Capital social (MXN)",
  "sociedad.objeto": "Objeto social",
  "sociedad.domicilio": "Domicilio social",
  "sociedad.orgao_admin": "Órgano de administración",
  "sociedad.admin_nombres": "Nombre(s) del administrador / consejo",
  "sociedad.tendra_trabajadores": "¿Tendrá trabajadores? (SÍ / NO)",
  "sociedad.max_trabajadores": "Máximo de trabajadores",
  "fees.constitucion": "Honorario constitución (MXN)",
  "fees.recurrente_usd": "Honorario recurrente (USD)",
};
