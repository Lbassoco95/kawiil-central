/**
 * Serializa errores de RPC/PostgREST de contratos a un mensaje legible.
 * Evita el toast `[object Object]` cuando el cliente recibe un plain object
 * (p. ej. PGRST202 schema cache) en lugar de un `Error`.
 */

type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  error?: unknown;
};

function asRecord(value: unknown): ErrorLike | null {
  if (value && typeof value === "object") return value as ErrorLike;
  return null;
}

function pickString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && c !== "[object Object]") return c.trim();
  }
  return null;
}

const RPC_CODE_MESSAGES: Record<string, string> = {
  no_organization: "Tu usuario no tiene organización asignada. Recarga la sesión o contacta a un admin.",
  lead_not_found: "No se encontró el lead en tu organización.",
  lead_not_converted:
    "El lead debe estar en etapa ganada (Cerrado) para iniciar el onboarding de contrato.",
  template_missing:
    "Falta la plantilla Softlanding/Backoffice en la base. Aplica el seed de contract_templates.",
};

export function formatContractRpcError(error: unknown, fallback = "No se pudo iniciar el onboarding"): string {
  if (error == null) return fallback;
  if (typeof error === "string") {
    return humanizeContractErrorCode(error) || error || fallback;
  }

  const rec = asRecord(error);
  if (!rec) return fallback;

  // PostgREST / supabase-js: { message, details, hint, code }
  const code = pickString(rec.code);
  const message = pickString(rec.message, rec.error, typeof rec.details === "string" ? rec.details : null);
  const details = pickString(rec.details);
  const hint = pickString(rec.hint);

  const combined = [message, details, hint].filter(Boolean).join(" — ");

  if (
    code === "PGRST202" ||
    /schema cache/i.test(combined) ||
    /could not find the function/i.test(combined) ||
    /Could not find the function/i.test(message || "")
  ) {
    return (
      "La función de contratos no está publicada en la API (caché de PostgREST). " +
      "Un admin debe ejecutar NOTIFY pgrst, 'reload schema'; en Supabase."
    );
  }

  if (message) {
    const mapped = humanizeContractErrorCode(message);
    if (mapped) return mapped;
    if (message.includes("lead_not_converted")) {
      return RPC_CODE_MESSAGES.lead_not_converted;
    }
    return message;
  }

  if (code && RPC_CODE_MESSAGES[code]) return RPC_CODE_MESSAGES[code];

  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

export function humanizeContractErrorCode(codeOrMessage: string): string | null {
  const key = codeOrMessage.trim();
  if (RPC_CODE_MESSAGES[key]) return RPC_CODE_MESSAGES[key];
  // "lead_not_converted: el lead está en…"
  const prefix = key.split(":")[0]?.trim();
  if (prefix && RPC_CODE_MESSAGES[prefix] && prefix !== key) {
    // Prefer the richer message already appended by the hook
    if (key.includes(":")) return key.replace(/^lead_not_converted:\s*/i, "").trim() || RPC_CODE_MESSAGES[prefix];
  }
  if (prefix && RPC_CODE_MESSAGES[prefix]) return RPC_CODE_MESSAGES[prefix];
  return null;
}
