export const ADMIN_CONSENT_REQUIRED = "admin_consent_required";

export class AdminConsentRequiredError extends Error {
  tenant: string | null;
  constructor(tenant: string | null) {
    super(ADMIN_CONSENT_REQUIRED);
    this.name = "AdminConsentRequiredError";
    this.tenant = tenant;
  }
}

export const ADMIN_CONSENT_DIALOG_TITLE = "Tu organización requiere la aprobación de un administrador";

export const ADMIN_CONSENT_DIALOG_BODY =
  "La política de Microsoft 365 de tu empresa no permite que conectes Kawiil por tu cuenta. Envía este enlace a tu administrador de Microsoft 365. Cuando lo apruebe, vuelve aquí y pulsa Conectar Outlook otra vez.";

/** Permisos delegados que pide Kawiil al conectar Outlook, en lenguaje claro. */
export const OUTLOOK_PERMISSIONS_PLAIN = [
  "Iniciar sesión y ver tu perfil básico (nombre y correo).",
  "Mantener la conexión activa sin pedirte iniciar sesión cada vez.",
  "Ver, crear y modificar eventos de tu calendario.",
  "Leer, organizar y mover los correos de tu buzón.",
  "Enviar correos en tu nombre.",
  "Leer y cambiar la configuración de tu buzón (zona horaria, respuestas automáticas).",
];

export const KAWIIL_ACCESS_NOTE =
  "Kawiil solo accede a la cuenta del usuario que la conecta; no obtiene acceso a otros buzones ni calendarios de la organización.";

export function buildAdminConsentMessage(consentUrl: string): string {
  return [
    "Hola,",
    "",
    "Quiero conectar mi cuenta de Microsoft 365 (Outlook) con Kawiil Central, pero la política de nuestra organización requiere la aprobación de un administrador.",
    "",
    "¿Podrías aprobar la aplicación Kawiil desde este enlace?",
    consentUrl,
    "",
    "Permisos que solicita (delegados, solo sobre la cuenta de quien la conecta):",
    ...OUTLOOK_PERMISSIONS_PLAIN.map((p) => `- ${p}`),
    "",
    KAWIIL_ACCESS_NOTE,
    "",
    "Gracias.",
  ].join("\n");
}

export function isAdminConsentRequiredCode(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === ADMIN_CONSENT_REQUIRED;
}
