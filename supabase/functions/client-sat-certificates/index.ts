import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  encryptFielSecret,
  sha256HexFromBase64File,
} from "../_shared/moffinFielCrypto.ts";
import {
  parseSatCertificate,
  rfcBasesMatch,
} from "../_shared/satCertificateParser.ts";
import {
  base64FileToBytes,
  encryptFielMaterialToSatgoJwe,
  fetchSatgoFielEncryptionKey,
} from "../_shared/satgoFielJwe.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action = "list" | "status" | "save" | "delete";

type CertType = "fiel" | "csd_sello";

interface RequestBody {
  action?: Action;
  clientId?: string;
  certType?: CertType;
  certificateBase64?: string;
  privateKeyBase64?: string;
  /** Contraseña de la e.firma: se cifra a JWE SATgo (no se guarda en claro). */
  privateKeyPassword?: string;
  label?: string | null;
  certificateId?: string;
  /** Si true, ignora la validacion de RFC contra clients.rfc (por sucursales con homoclave distinta). */
  forceRfcMismatch?: boolean;
}

interface CertRow {
  id: string;
  cert_type: CertType;
  label: string | null;
  cert_serial: string | null;
  cert_subject_rfc: string | null;
  cert_not_before: string | null;
  cert_not_after: string | null;
  cert_fingerprint_sha256: string | null;
  updated_at: string;
  satgo_key_jwe?: string | null;
  satgo_password_jwe?: string | null;
  satgo_jwe_kid?: string | null;
  satgo_jwe_updated_at?: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function daysLeft(notAfter: string | null): number | null {
  if (!notAfter) return null;
  const ts = Date.parse(notAfter);
  if (Number.isNaN(ts)) return null;
  return Math.ceil((ts - Date.now()) / (1000 * 60 * 60 * 24));
}

function summarizeRow(row: CertRow) {
  const satgoJweReady = !!(
    row.satgo_key_jwe?.trim() && row.satgo_password_jwe?.trim()
  );
  return {
    id: row.id,
    certType: row.cert_type,
    label: row.label,
    certSerial: row.cert_serial,
    certSubjectRfc: row.cert_subject_rfc,
    certNotBefore: row.cert_not_before,
    certNotAfter: row.cert_not_after,
    certFingerprint: row.cert_fingerprint_sha256,
    updatedAt: row.updated_at,
    daysLeft: daysLeft(row.cert_not_after),
    satgoJweReady,
    satgoJweKid: row.satgo_jwe_kid ?? null,
    satgoJweUpdatedAt: row.satgo_jwe_updated_at ?? null,
  };
}

function pickAccessToken(jsonBody: Record<string, unknown>): string | null {
  const nested = jsonBody.tokens;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const access = (nested as Record<string, unknown>).access;
    if (access && typeof access === "object" && !Array.isArray(access)) {
      const v = (access as Record<string, unknown>).value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (typeof jsonBody.token === "string" && jsonBody.token.trim()) return jsonBody.token.trim();
  if (typeof jsonBody.accessToken === "string" && jsonBody.accessToken.trim()) {
    return jsonBody.accessToken.trim();
  }
  return null;
}

async function resolveSatgoBearerForJwe(
  admin: ReturnType<typeof createClient>,
): Promise<string | null> {
  let apiKey = Deno.env.get("SATGO_API_KEY")?.trim() ?? "";
  let access = Deno.env.get("SATGO_ACCESS_TOKEN")?.trim() ?? "";
  if (!apiKey && !access) {
    try {
      const { data } = await admin.rpc("kawiil_vault_secret", {
        secret_name: "satgo_api_key",
      });
      if (typeof data === "string" && data.trim()) apiKey = data.trim();
    } catch {
      /* ignore */
    }
  }
  if (apiKey) {
    const base = (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(
      /\/$/,
      "",
    );
    const res = await fetch(`${base}/api/Auth/token-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key: apiKey }),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok) return null;
    return pickAccessToken(parsed);
  }
  return access || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const fielSecret = Deno.env.get("MOFFIN_FIEL_SECRET") ?? "";

  const rawAuth =
    req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const bearerMatch = rawAuth.match(/^Bearer\s+(\S+)/i);
  const accessToken = bearerMatch?.[1];
  if (!accessToken) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(
    accessToken,
  );
  const user = userData?.user;
  if (authError || !user) {
    console.error(
      "client-sat-certificates auth:",
      authError?.message ?? "sin usuario",
    );
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "JSON invalido" }, 400);
  }

  const action = body.action;
  const clientId = body.clientId?.trim();
  const allowedActions: Action[] = ["list", "status", "save", "delete"];
  if (!action || !allowedActions.includes(action)) {
    return jsonResponse(
      { error: "action requerida (list|status|save|delete)" },
      400,
    );
  }
  if (!clientId && action !== "delete") {
    return jsonResponse({ error: "clientId requerido" }, 400);
  }

  const { data: profile, error: profErr } = await userClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (profErr || !profile?.organization_id) {
    return jsonResponse({ error: "Perfil no encontrado" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let client: { id: string; organization_id: string; rfc: string | null } | null = null;
  if (clientId) {
    const { data: c, error: clientErr } = await userClient
      .from("clients")
      .select("id, organization_id, rfc")
      .eq("id", clientId)
      .single();
    if (
      clientErr ||
      !c ||
      c.organization_id !== profile.organization_id
    ) {
      return jsonResponse({ error: "Cliente no encontrado o sin acceso" }, 403);
    }
    client = c as typeof client;
  }

  if (action === "list" || action === "status") {
    const { data: rows, error } = await admin
      .from("client_sat_certificates")
      .select(
        "id, cert_type, label, cert_serial, cert_subject_rfc, cert_not_before, cert_not_after, cert_fingerprint_sha256, updated_at, satgo_key_jwe, satgo_password_jwe, satgo_jwe_kid, satgo_jwe_updated_at",
      )
      .eq("client_id", clientId!)
      .order("cert_type", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("client_sat_certificates list:", error.message);
      return jsonResponse({ error: error.message }, 500);
    }

    const items = (rows ?? []).map((r) => summarizeRow(r as CertRow));
    const fiel = items.find((r) => r.certType === "fiel") ?? null;
    const csds = items.filter((r) => r.certType === "csd_sello");

    return jsonResponse({
      items,
      fiel,
      csds,
      // Compat con la UI antigua de moffin-fiel:
      configured: !!fiel,
      satgoJweReady: !!fiel?.satgoJweReady,
      certFingerprint: fiel?.certFingerprint ?? null,
      updatedAt: fiel?.updatedAt ?? null,
    });
  }

  if (action === "delete") {
    const certificateId = body.certificateId?.trim();
    if (certificateId) {
      const { data: row, error: getErr } = await admin
        .from("client_sat_certificates")
        .select("id, organization_id")
        .eq("id", certificateId)
        .maybeSingle();
      if (getErr || !row || row.organization_id !== profile.organization_id) {
        return jsonResponse({ error: "Certificado no encontrado o sin acceso" }, 403);
      }
      await admin
        .from("client_sat_certificates")
        .delete()
        .eq("id", certificateId);
      return jsonResponse({ ok: true });
    }

    if (!clientId) {
      return jsonResponse({ error: "clientId o certificateId requerido" }, 400);
    }
    const certType = body.certType ?? "fiel";
    await admin
      .from("client_sat_certificates")
      .delete()
      .eq("client_id", clientId)
      .eq("cert_type", certType);
    return jsonResponse({ ok: true });
  }

  // ---- save ----
  if (fielSecret.length < 32) {
    return jsonResponse(
      {
        error: "fiel_not_configured",
        message:
          "Configura MOFFIN_FIEL_SECRET en Edge Functions (minimo 32 caracteres) para guardar certificados.",
      },
      503,
    );
  }

  const certType: CertType = body.certType === "csd_sello" ? "csd_sello" : "fiel";
  const certB64 = body.certificateBase64?.trim() ?? "";
  const keyB64 = body.privateKeyBase64?.trim() ?? "";
  const label = body.label?.trim() || null;
  const privateKeyPassword =
    typeof body.privateKeyPassword === "string"
      ? body.privateKeyPassword.trim()
      : "";

  if (!certB64 || !keyB64) {
    return jsonResponse(
      {
        error: "certificate_required",
        message:
          "Envia certificateBase64 y privateKeyBase64 (archivos .cer y .key en base64).",
      },
      400,
    );
  }

  if (certType === "fiel" && !privateKeyPassword) {
    return jsonResponse(
      {
        error: "fiel_password_required",
        message:
          "Para CSF/32D con SATgo, indica la contraseña de la e.firma: se cifra a JWE y no se guarda en claro.",
      },
      400,
    );
  }

  let parsed;
  try {
    parsed = parseSatCertificate(certB64);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      {
        error: "certificate_parse_failed",
        message:
          "No se pudo leer el .cer (debe ser DER del SAT). Detalle: " + msg,
      },
      400,
    );
  }

  if (!body.forceRfcMismatch && client?.rfc && parsed.subjectRfc) {
    if (!rfcBasesMatch(client.rfc, parsed.subjectRfc)) {
      return jsonResponse(
        {
          error: "rfc_mismatch",
          message: `El RFC del certificado (${parsed.subjectRfc}) no coincide con el RFC del cliente (${client.rfc}). Si es una sucursal o RFC alterno valido, reintenta marcando forceRfcMismatch.`,
          certificateRfc: parsed.subjectRfc,
          clientRfc: client.rfc,
        },
        409,
      );
    }
  }

  try {
    const certEnc = await encryptFielSecret(certB64, fielSecret);
    const keyEnc = await encryptFielSecret(keyB64, fielSecret);
    const fp = await sha256HexFromBase64File(certB64);

    let satgoKeyJwe: string | null = null;
    let satgoPasswordJwe: string | null = null;
    let satgoJweKid: string | null = null;
    let satgoJweUpdatedAt: string | null = null;

    if (certType === "fiel" && privateKeyPassword) {
      const bearer = await resolveSatgoBearerForJwe(admin);
      if (!bearer) {
        return jsonResponse(
          {
            error: "satgo_not_configured",
            message:
              "Configura SATGO_API_KEY para cifrar la e.firma a JWE (SATgo).",
          },
          503,
        );
      }
      try {
        const encKey = await fetchSatgoFielEncryptionKey(bearer);
        const jwe = await encryptFielMaterialToSatgoJwe(
          base64FileToBytes(keyB64),
          privateKeyPassword,
          encKey,
        );
        satgoKeyJwe = jwe.keyJwe;
        satgoPasswordJwe = jwe.passwordJwe;
        satgoJweKid = jwe.kid;
        satgoJweUpdatedAt = new Date().toISOString();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonResponse(
          {
            error: "satgo_jwe_encrypt_failed",
            message: `No se pudo cifrar la e.firma para SATgo: ${msg}`,
          },
          502,
        );
      }
    }

    const upsertRow: Record<string, unknown> = {
      organization_id: client!.organization_id,
      client_id: clientId!,
      cert_type: certType,
      label,
      cert_ciphertext: certEnc,
      key_ciphertext: keyEnc,
      cert_serial: parsed.serialNumber,
      cert_subject_rfc: parsed.subjectRfc,
      cert_not_before: parsed.notBefore,
      cert_not_after: parsed.notAfter,
      cert_fingerprint_sha256: fp,
      last_reminder_bucket: null,
      last_reminder_at: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };

    if (certType === "fiel") {
      upsertRow.satgo_key_jwe = satgoKeyJwe;
      upsertRow.satgo_password_jwe = satgoPasswordJwe;
      upsertRow.satgo_jwe_kid = satgoJweKid;
      upsertRow.satgo_jwe_updated_at = satgoJweUpdatedAt;
    }

    // Índices UNIQUE son parciales (WHERE cert_type='fiel' / cert_serial IS NOT NULL);
    // PostgREST no puede ON CONFLICT sobre ellos → update/insert manual.
    let existingId: string | null = null;
    if (certType === "fiel") {
      const { data: existing } = await admin
        .from("client_sat_certificates")
        .select("id")
        .eq("client_id", clientId!)
        .eq("cert_type", "fiel")
        .maybeSingle();
      existingId = existing?.id ?? null;
    } else if (parsed.serialNumber) {
      const { data: existing } = await admin
        .from("client_sat_certificates")
        .select("id")
        .eq("client_id", clientId!)
        .eq("cert_serial", parsed.serialNumber)
        .maybeSingle();
      existingId = existing?.id ?? null;
    }

    const selectCols =
      "id, cert_type, label, cert_serial, cert_subject_rfc, cert_not_before, cert_not_after, cert_fingerprint_sha256, updated_at, satgo_key_jwe, satgo_password_jwe, satgo_jwe_kid, satgo_jwe_updated_at";

    let upserted: CertRow | null = null;
    if (existingId) {
      const { data, error: upErr } = await admin
        .from("client_sat_certificates")
        .update(upsertRow)
        .eq("id", existingId)
        .select(selectCols)
        .maybeSingle();
      if (upErr) {
        console.error("client_sat_certificates update:", upErr.message);
        return jsonResponse({ error: upErr.message }, 500);
      }
      upserted = (data as CertRow | null) ?? null;
    } else {
      const { data, error: insErr } = await admin
        .from("client_sat_certificates")
        .insert(upsertRow)
        .select(selectCols)
        .maybeSingle();
      if (insErr) {
        console.error("client_sat_certificates insert:", insErr.message);
        return jsonResponse({ error: insErr.message }, 500);
      }
      upserted = (data as CertRow | null) ?? null;
    }

    return jsonResponse({
      ok: true,
      certificate: upserted ? summarizeRow(upserted) : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "encrypt_failed", message: msg }, 500);
  }
});
