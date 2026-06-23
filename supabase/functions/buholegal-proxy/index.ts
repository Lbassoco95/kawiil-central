import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Búho Legal — proxy seguro entre el frontend y la API de expedientes.
 *
 * Producto "Manejo de alertas" (NO requiere autorización extra) — todo en un
 * solo host: https://miscasos-expedientes.buholegal.com
 *   · Login/sesión:  POST /api/v1/users/login/  {username, password} -> {access, refresh}
 *   · Catálogos:     /api/v1/info/circuitos, /api/v1/info/juzgados/{entidad},
 *                    /api/v1/info/tipos/expedientes/{entidad}, /api/v1/info/tiposEntidades
 *   · Alertas:       /api/v1/info/alertas[...]/{entidad}[/{id}]
 *   · Acuerdos:      /api/v1/info/acuerdos/{entidad}/{id}, .../nuevos/{entidad}[/{id}]
 *
 * Los productos de Monitoreo/Expedientes y Cédulas SÍ requieren autorización y
 * viven en otros hosts (p. ej. monitoreo.buholegal.com con otras rutas). Por eso
 * AUTH_BASE / EXP_BASE / BUHOLEGAL_LOGIN_PATH son configurables por secret, para
 * apuntarlos sin redeploy cuando se habiliten.
 *
 * Las credenciales (BUHOLEGAL_USERNAME / BUHOLEGAL_PASSWORD) viven como secrets de
 * Supabase Edge Functions y NUNCA llegan al cliente. El cliente sólo manda un
 * `action` y el proxy traduce a la ruta REST correspondiente.
 *
 * ⚠️ La API de Búho Legal requiere autorización previa de su parte
 *    (escribir a contacto@buholegal.com antes de usar en producción).
 *
 * Acciones soportadas (en el body como `action`):
 *   get_circuitos
 *   get_juzgados          { entidad }
 *   get_tipos_expediente  { entidad }
 *   create_alerta         { entidad, payload: { nombre_alerta, numero_expediente, juzgado, tipo_expediente? } }
 *   get_acuerdos          { entidad, id_alerta }
 *   get_acuerdos_nuevos   { entidad, id_alerta? }
 *   delete_alerta         { entidad, id_alerta }
 */

const stripSlash = (s: string) => s.replace(/\/$/, "");

// El producto "Manejo de alertas" (no requiere autorización extra) vive entero
// en miscasos-expedientes.buholegal.com: login + catálogos + alertas + acuerdos,
// todo con prefijo /api/v1/info/ (salvo el login).
//
// AUTH_BASE es configurable por si más adelante se habilita el producto de
// Monitoreo/Expedientes (monitoreo.buholegal.com), que usa otros hosts/paths.
const ALERTAS_HOST = "https://miscasos-expedientes.buholegal.com";

// Host de autenticación + catálogos (por defecto, el mismo host de alertas).
const AUTH_BASE = stripSlash(
  Deno.env.get("BUHOLEGAL_AUTH_BASE") ?? ALERTAS_HOST,
);
// Host de alertas + acuerdos.
const EXP_BASE = stripSlash(
  Deno.env.get("BUHOLEGAL_EXPEDIENTES_BASE") ?? ALERTAS_HOST,
);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Cache simple del token en memoria (válido mientras vive el worker).
let cachedToken: { access: string; expires_at: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access;
  }
  const username = Deno.env.get("BUHOLEGAL_USERNAME");
  const password = Deno.env.get("BUHOLEGAL_PASSWORD");
  if (!username || !password) {
    throw new Error(
      "buholegal_not_configured: configura BUHOLEGAL_USERNAME y BUHOLEGAL_PASSWORD en los secrets de Edge Functions.",
    );
  }
  // Django/DRF puede o no exigir la barra final; probamos con barra y, si da 404,
  // reintentamos sin barra. La ruta también es configurable por secret.
  const loginPath = Deno.env.get("BUHOLEGAL_LOGIN_PATH") ?? "/api/v1/users/login/";
  const body = JSON.stringify({ username, password });
  const doLogin = (path: string) =>
    fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  let res = await doLogin(loginPath);
  if (res.status === 404 && loginPath.endsWith("/")) {
    res = await doLogin(loginPath.replace(/\/$/, ""));
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`BuhoLegal login error ${res.status}: ${err.slice(0, 500)}`);
  }
  const data = await res.json();
  if (!data?.access) {
    throw new Error("BuhoLegal login: respuesta sin token `access`.");
  }
  // El JWT de Búho Legal dura ~30 min; cacheamos 25 min con margen.
  cachedToken = { access: data.access, expires_at: Date.now() + 25 * 60 * 1000 };
  return data.access;
}

async function bhl(base: string, path: string, options: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`BuhoLegal error ${res.status}: ${err.slice(0, 800)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Verificar usuario autenticado en Supabase ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const rawAuth =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const accessToken = rawAuth.match(/^Bearer\s+(\S+)/i)?.[1];
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData, error: authError } =
      await userClient.auth.getUser(accessToken);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: {
      action?: string;
      entidad?: string;
      id_alerta?: number;
      payload?: {
        nombre_alerta: string;
        numero_expediente: string;
        juzgado: number;
        tipo_expediente?: number;
      };
    };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "JSON inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enc = (s: string) => encodeURIComponent(s);
    let result: unknown;

    switch (body.action) {
      // ── Catálogos (host de alertas, prefijo /api/v1/info/) ──
      case "get_circuitos":
        result = await bhl(AUTH_BASE, "/api/v1/info/circuitos");
        break;
      case "get_tipos_entidades":
        // Entidades que requieren tipo_expediente.
        result = await bhl(AUTH_BASE, "/api/v1/info/tiposEntidades");
        break;
      case "get_juzgados":
        if (!body.entidad) throw new Error("entidad requerida");
        result = await bhl(AUTH_BASE, `/api/v1/info/juzgados/${enc(body.entidad)}`);
        break;
      case "get_tipos_expediente":
        if (!body.entidad) throw new Error("entidad requerida");
        result = await bhl(
          AUTH_BASE,
          `/api/v1/info/tipos/expedientes/${enc(body.entidad)}`,
        );
        break;
      // ── Alertas y acuerdos (host de expedientes) ──
      case "create_alerta":
        if (!body.entidad) throw new Error("entidad requerida");
        if (!body.payload?.nombre_alerta || !body.payload?.numero_expediente) {
          throw new Error("payload requiere nombre_alerta y numero_expediente");
        }
        result = await bhl(EXP_BASE, `/api/v1/info/alertas/create/${enc(body.entidad)}`, {
          method: "POST",
          body: JSON.stringify(body.payload),
        });
        break;
      case "get_acuerdos":
        if (!body.entidad || body.id_alerta == null) {
          throw new Error("entidad e id_alerta requeridos");
        }
        result = await bhl(
          EXP_BASE,
          `/api/v1/info/acuerdos/${enc(body.entidad)}/${body.id_alerta}`,
        );
        break;
      case "get_acuerdos_nuevos": {
        if (!body.entidad) throw new Error("entidad requerida");
        const path =
          body.id_alerta != null
            ? `/api/v1/info/acuerdos/nuevos/${enc(body.entidad)}/${body.id_alerta}`
            : `/api/v1/info/acuerdos/nuevos/${enc(body.entidad)}`;
        result = await bhl(EXP_BASE, path);
        break;
      }
      case "delete_alerta":
        if (!body.entidad || body.id_alerta == null) {
          throw new Error("entidad e id_alerta requeridos");
        }
        result = await bhl(
          EXP_BASE,
          `/api/v1/info/alertas/delete/${enc(body.entidad)}/${body.id_alerta}`,
          { method: "DELETE" },
        );
        break;
      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
