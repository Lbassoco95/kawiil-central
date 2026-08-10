// Cliente compartido para la API de Búho Legal (monitoreo de expedientes).
// https://monitoreo.buholegal.com/api/v1/
//
// Auth JWT: POST /users/login/ {email,password} -> {data:{access,refresh}}.
// El token se cachea en la tabla `buho_auth` (una fila por organización) para no
// hacer login en cada request. En 401 se re-loguea automáticamente y reintenta.
//
// Credenciales vía secretos de la función (NUNCA en el repo):
//   BUHO_EMAIL, BUHO_PASSWORD, y opcional BUHO_BASE_URL.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const BUHO_BASE_URL =
  (Deno.env.get("BUHO_BASE_URL") || "https://monitoreo.buholegal.com/api/v1").replace(/\/$/, "");

// Los access JWT suelen durar ~1h; renovamos con holgura.
const ACCESS_TTL_MS = 55 * 60 * 1000;

export interface BuhoResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  errorType?: string;
}

async function login(): Promise<{ access: string; refresh: string }> {
  const email = Deno.env.get("BUHO_EMAIL");
  const password = Deno.env.get("BUHO_PASSWORD");
  if (!email || !password) {
    throw new Error("Faltan secretos BUHO_EMAIL / BUHO_PASSWORD en la función.");
  }
  const res = await fetch(`${BUHO_BASE_URL}/users/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data?.access) {
    throw new Error(`Login Búho falló (${res.status}): ${json?.message || "sin detalle"}`);
  }
  return { access: json.data.access as string, refresh: json.data.refresh as string };
}

/** Obtiene un access token válido para la organización (cache + refresh). */
export async function getBuhoToken(
  supabase: SupabaseClient,
  organizationId: string,
  forceRenew = false,
): Promise<string> {
  if (!forceRenew) {
    const { data } = await supabase
      .from("buho_auth")
      .select("access, access_expires_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data?.access && data.access_expires_at && Date.parse(data.access_expires_at) > Date.now()) {
      return data.access as string;
    }
  }
  const { access, refresh } = await login();
  await supabase.from("buho_auth").upsert(
    {
      organization_id: organizationId,
      access,
      refresh,
      access_expires_at: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  return access;
}

/**
 * Llama a la API de Búho con el token cacheado. Si responde 401, renueva el token
 * y reintenta una vez.
 */
export async function buhoFetch<T = unknown>(
  supabase: SupabaseClient,
  organizationId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<BuhoResult<T>> {
  const doFetch = async (token: string) => {
    const res = await fetch(`${BUHO_BASE_URL}${path}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  let token = await getBuhoToken(supabase, organizationId);
  let { res, json } = await doFetch(token);

  if (res.status === 401) {
    token = await getBuhoToken(supabase, organizationId, true);
    ({ res, json } = await doFetch(token));
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: json?.message || `HTTP ${res.status}`,
      errorType: json?.error_type,
    };
  }
  // La API envuelve en {success, data}; devolvemos data si existe.
  const payload = (json && "data" in json ? json.data : json) as T;
  return { ok: true, status: res.status, data: payload };
}

/** Mapea nuestra rama/jurisdicción interna a la `entidad` de Búho. */
export function jurisdictionToEntidad(jurisdiction?: string | null): string | null {
  switch (jurisdiction) {
    case "cdmx":
      return "cdmx";
    case "edomex":
      return "estado_mexico";
    case "federal":
      return "federal";
    default:
      return null;
  }
}
