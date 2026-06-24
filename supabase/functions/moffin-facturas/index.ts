/**
 * Consulta de Facturas SAT (CFDI) vía Moffin Solutions.
 *
 * Flujo (estilo Solutions, idéntico a CSF/32D):
 *  1. Auth del usuario (Bearer) → organización.
 *  2. Carga proyecto + cliente (RFC) y valida acceso por organización.
 *  3. Resuelve Bearer Solutions (OAuth o estático).
 *  4. Recupera la CIEC cifrada del cliente y, si no hay profileId, crea el perfil SAT
 *     (POST /query/sat/profile con {rfc, ciec}). La CIEC NUNCA viaja en el body de la
 *     consulta de facturas ni se registra en logs.
 *  5. POST a la ruta de facturas (MOFFIN_SOLUTIONS_PATH_CFDI, default /query/sat/cfdi)
 *     con {rfc, startdate, enddate}.
 *  6. Normaliza los CFDIs, calcula el contador de vigentes (emitidas/recibidas) y
 *     persiste SOLO el conteo en moffin_cfdi_counts (control). Devuelve el detalle al
 *     frontend para mostrarlo en pantalla (no se persiste el detalle).
 *
 * verify_jwt=false en config.toml: el JWT del usuario se valida manualmente (igual que moffin-query).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptFielSecret } from "../_shared/moffinFielCrypto.ts";
import {
  getMoffinApiFlavor,
  moffinLegacyApiKey,
  moffinLegacyBaseUrl,
  moffinSolutionsBaseUrl,
} from "../_shared/moffinApiFlavor.ts";
import { resolveMoffinSolutionsBearer } from "../_shared/moffinSolutionsAuth.ts";
import {
  extractMoffinProfileId,
  extractSolutionsQueryId,
  moffinSolutionsGetJson,
  moffinSolutionsPostJson,
} from "../_shared/moffinSolutionsClient.ts";
import { moffinSolutionsProfilePath } from "../_shared/moffinQueryPaths.ts";
import {
  computeCfdiCounters,
  extractCfdiArray,
  moffinLegacyCfdiPathCandidates,
  moffinSolutionsCfdiPathCandidates,
  normalizeCfdi,
} from "../_shared/moffinCfdi.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const flavor = getMoffinApiFlavor();
  if (flavor !== "solutions") {
    return jsonResponse(
      {
        error: "facturas_requires_solutions",
        message:
          "La consulta de Facturas SAT (CFDI) requiere Moffin Solutions con CIEC. Configura el flavor Solutions.",
      },
      503,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Auth del usuario ──
  const rawAuth = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const accessToken = rawAuth.match(/^Bearer\s+(\S+)/i)?.[1];
  if (!accessToken) return jsonResponse({ error: "No autorizado" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (authError || !user) return jsonResponse({ error: "No autorizado" }, 401);

  // ── Body ──
  let body: { projectId?: string; startdate?: string; enddate?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const startdate = typeof body.startdate === "string" ? body.startdate.trim() : "";
  const enddate = typeof body.enddate === "string" ? body.enddate.trim() : "";
  if (!projectId) return jsonResponse({ error: "projectId requerido" }, 400);
  if (!ISO_DATE.test(startdate) || !ISO_DATE.test(enddate)) {
    return jsonResponse(
      { error: "rango_invalido", message: "startdate y enddate deben tener formato YYYY-MM-DD." },
      400,
    );
  }
  if (startdate > enddate) {
    return jsonResponse(
      { error: "rango_invalido", message: "La fecha de inicio no puede ser mayor que la fecha fin." },
      400,
    );
  }

  // ── Perfil / organización ──
  const { data: profile, error: profErr } = await userClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (profErr || !profile?.organization_id) return jsonResponse({ error: "Perfil no encontrado" }, 403);

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Proyecto + cliente ──
  const { data: project, error: projError } = await admin
    .from("projects")
    .select("id, organization_id, client_id, clients(rfc)")
    .eq("id", projectId)
    .maybeSingle();
  if (projError || !project) return jsonResponse({ error: "Proyecto no encontrado" }, 404);
  if (project.organization_id !== profile.organization_id) {
    return jsonResponse({ error: "Sin acceso al proyecto" }, 403);
  }
  if (!project.client_id) {
    return jsonResponse(
      { error: "client_required", message: "El proyecto debe tener un cliente asociado." },
      400,
    );
  }
  const clientRow = project.clients as { rfc: string | null } | null;
  const rfc = clientRow?.rfc?.trim().toUpperCase().replace(/\s/g, "") ?? "";
  if (!rfc) {
    return jsonResponse(
      { error: "rfc_required", message: "El cliente del proyecto no tiene RFC configurado." },
      400,
    );
  }

  // ── Bearer Solutions ──
  const solutionsBase = moffinSolutionsBaseUrl();
  const solAuth = await resolveMoffinSolutionsBearer(solutionsBase);
  if (!solAuth.ok) {
    const code =
      "code" in solAuth && solAuth.code === "oauth_incomplete"
        ? "moffin_solutions_oauth_incomplete"
        : "moffin_solutions_auth";
    return jsonResponse({ error: code, message: solAuth.message }, 503);
  }
  const solutionsBearer = solAuth.bearer;
  const solutionsAuthScheme = solAuth.scheme;
  const solutionsAuthVia = solAuth.via;

  // ── CIEC + profileId ──
  const ciecSecret =
    Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ||
    Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ||
    "";
  if (ciecSecret.length < 32) {
    return jsonResponse(
      {
        error: "ciec_not_configured",
        message: "Configura MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (≥32 caracteres).",
      },
      503,
    );
  }
  const { data: ciecRow } = await admin
    .from("moffin_client_sat_ciec")
    .select("ciec_ciphertext, moffin_profile_id")
    .eq("client_id", project.client_id)
    .maybeSingle();
  if (!ciecRow?.ciec_ciphertext) {
    return jsonResponse(
      {
        error: "ciec_required",
        message: "Guarda la CIEC del cliente (Moffin Solutions) antes de consultar facturas.",
      },
      400,
    );
  }
  // Descifra la CIEC una vez: se usa para crear el perfil SAT (Solutions) y, como fallback,
  // en el body del API legacy. NUNCA se registra en logs.
  let ciecPlain: string;
  try {
    ciecPlain = await decryptFielSecret(ciecRow.ciec_ciphertext, ciecSecret);
  } catch (e) {
    return jsonResponse(
      { error: "ciec_decrypt_failed", message: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
  let profileId: number | null =
    typeof ciecRow.moffin_profile_id === "number" ? ciecRow.moffin_profile_id : null;
  if (profileId == null) {
    const profRes = await moffinSolutionsPostJson(
      solutionsBase,
      solutionsBearer,
      moffinSolutionsProfilePath(),
      { rfc, ciec: ciecPlain },
      solutionsAuthScheme,
    );
    // ciecPlain queda fuera de scope tras este punto; nunca se registra en logs.
    if (!profRes.ok) {
      return jsonResponse(
        {
          error: "moffin_profile_failed",
          message: profRes.message,
          statusCode: profRes.status,
          authUsed: solutionsAuthVia,
        },
        422,
      );
    }
    profileId = extractMoffinProfileId(profRes.json);
    if (profileId == null) {
      return jsonResponse(
        { error: "moffin_profile_invalid", message: "Moffin no devolvió profileId al crear el perfil SAT." },
        422,
      );
    }
    await admin
      .from("moffin_client_sat_ciec")
      .update({ moffin_profile_id: profileId, updated_at: new Date().toISOString() })
      .eq("client_id", project.client_id);
  }

  // ── Consulta de facturas (CFDI) — CIEC NO va en el body ──
  // Estilo Solutions: el perfil (CIEC) ya quedó asociado al RFC arriba; la consulta usa RFC + rango.
  // El path de facturas no está documentado públicamente; probamos candidatos. Un 404 / HTML
  // (no-JSON) = ese path no existe → siguiente (sin cargo). El primero que responde JSON es el bueno.
  const cfdiCandidates = moffinSolutionsCfdiPathCandidates();
  const probe: Array<{ path: string; status: number; message: string }> = [];
  let chosen: Awaited<ReturnType<typeof moffinSolutionsPostJson>> | null = null;
  let usedPath = "";
  for (const p of cfdiCandidates) {
    const r = await moffinSolutionsPostJson(
      solutionsBase,
      solutionsBearer,
      p,
      { rfc, startdate, enddate },
      solutionsAuthScheme,
    );
    if (r.ok) {
      chosen = r;
      usedPath = p;
      break;
    }
    probe.push({ path: p, status: r.status, message: r.message });
    const pathMissing = r.status === 404 || /no es JSON/i.test(r.message);
    if (!pathMissing) {
      // El endpoint existe pero rechazó la consulta: ese es el error real, deja de probar.
      chosen = r;
      usedPath = p;
      break;
    }
  }

  // ── Fallback: API legacy (app.moffin.mx), patrón documentado de facturas ──
  // Solo si Solutions no tiene el endpoint. Aquí la CIEC SÍ va en el body (patrón legacy
  // que documenta Moffin: {externalId, rfc, CIEC, startdate, enddate}); nunca se loguea.
  if (!chosen) {
    const legacyBase = moffinLegacyBaseUrl();
    const legacyToken = moffinLegacyApiKey().trim();
    if (legacyToken) {
      const externalId = `kawiil-facturas-${projectId}-${Date.now()}`;
      for (const p of moffinLegacyCfdiPathCandidates()) {
        const r = await moffinSolutionsPostJson(
          legacyBase,
          legacyToken,
          p,
          { externalId, rfc, CIEC: ciecPlain, startdate, enddate },
          "Token",
        );
        if (r.ok) {
          chosen = r;
          usedPath = `legacy:${p}`;
          break;
        }
        probe.push({ path: `legacy:${p}`, status: r.status, message: r.message });
        const pathMissing = r.status === 404 || /no es JSON/i.test(r.message);
        if (!pathMissing) {
          chosen = r;
          usedPath = `legacy:${p}`;
          break;
        }
      }
    } else {
      probe.push({
        path: "legacy",
        status: 0,
        message: "Sin MOFFIN_API_KEY / MOFFIN_LEGACY_API_KEY para intentar el API legacy.",
      });
    }
  }

  if (!chosen) {
    console.warn(`moffin-facturas: ningún path respondió. Probados: ${probe.map((x) => `${x.path}=${x.status}`).join(", ")}`);
    return jsonResponse(
      {
        error: "facturas_not_enabled",
        message:
          `Ningún endpoint de Facturas SAT (CFDI) respondió en Moffin (probados Solutions y legacy: ${probe
            .map((x) => `${x.path} → ${x.status}`)
            .join(", ")}). Es probable que la consulta de facturas no esté habilitada para tu cuenta/credenciales, o que el path sea distinto. Confirma con Moffin el endpoint exacto y configúralo en MOFFIN_SOLUTIONS_PATH_CFDI (Solutions) o MOFFIN_LEGACY_PATH_CFDI (legacy).`,
        probed: probe,
      },
      422,
    );
  }
  if (!chosen.ok) {
    return jsonResponse(
      {
        error: chosen.status === 403 ? "facturas_not_enabled" : "moffin_api_error",
        message: `Origen: Moffin API en ${usedPath}. ${chosen.message}`,
        statusCode: chosen.status,
        path: usedPath,
      },
      422,
    );
  }

  // ── Posible respuesta asíncrona: si trae queryId pero aún no el arreglo, intenta un GET ──
  let json = chosen.json;
  let cfdiRaw = extractCfdiArray(json);
  if (!cfdiRaw) {
    const queryId = extractSolutionsQueryId(json);
    if (queryId) {
      const getRes = await moffinSolutionsGetJson(
        solutionsBase,
        solutionsBearer,
        queryId,
        solutionsAuthScheme,
      );
      if (getRes.ok) {
        json = getRes.json;
        cfdiRaw = extractCfdiArray(json);
      }
      if (!cfdiRaw) {
        return jsonResponse({
          status: "pending",
          message:
            "Moffin recibió la consulta de facturas pero aún la está procesando. Vuelve a consultar en unos minutos.",
          moffinQueryId: queryId,
          counters: null,
          cfdis: [],
        });
      }
    }
  }

  const cfdis = (cfdiRaw ?? []).map((c) => normalizeCfdi(c, rfc));
  const counters = computeCfdiCounters(cfdis);

  // ── Persistir SOLO el contador (control). El detalle no se guarda. ──
  const { data: countRow, error: countErr } = await admin
    .from("moffin_cfdi_counts")
    .insert({
      organization_id: project.organization_id,
      project_id: projectId,
      client_id: project.client_id,
      rfc,
      period_start: startdate,
      period_end: enddate,
      total_cfdi: counters.totalCfdi,
      total_vigentes: counters.totalVigentes,
      total_canceladas: counters.totalCanceladas,
      emitidas_vigentes: counters.emitidasVigentes,
      recibidas_vigentes: counters.recibidasVigentes,
      emitidas_vigentes_total_mxn: counters.emitidasVigentesTotalMxn,
      recibidas_vigentes_total_mxn: counters.recibidasVigentesTotalMxn,
      requested_by: user.id,
    })
    .select("id, created_at")
    .single();
  if (countErr) console.error("moffin_cfdi_counts insert:", countErr.message);

  return jsonResponse({
    status: "success",
    counters,
    cfdis,
    period: { startdate, enddate },
    countId: countRow?.id ?? null,
  });
});
