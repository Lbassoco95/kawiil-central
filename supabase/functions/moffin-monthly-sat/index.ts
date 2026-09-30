/**
 * Descarga mensual automática de constancia de situación fiscal (CSF) y opinión de
 * cumplimiento (32D) para todos los clientes con CIEC registrada — "desde sistema",
 * sin que los contadores tengan que dispararla a mano.
 *
 * Preferencia: SATgo (PDF síncrono) si SATGO_API_KEY / SATGO_ACCESS_TOKEN están
 * configurados; si no, Moffin Solutions (async + refreshAllPending).
 *
 * Disparo: pg_cron mensual (días 1-5) con cabecera x-cron-secret = CRON_SECRET.
 * Idempotente: si un cliente ya tiene una consulta success/pending del tipo en el mes
 * en curso, se omite.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptFielSecret } from "../_shared/moffinFielCrypto.ts";
import { getMoffinApiFlavor, moffinSolutionsBaseUrl } from "../_shared/moffinApiFlavor.ts";
import { resolveMoffinSolutionsBearer } from "../_shared/moffinSolutionsAuth.ts";
import {
  extractMoffinProfileId,
  extractSolutionsQueryId,
  moffinSolutionsPostJson,
  type MoffinSolutionsAuthScheme,
} from "../_shared/moffinSolutionsClient.ts";
import {
  moffinQueryServiceSegment,
  moffinSolutionsProfilePath,
  moffinSolutionsQueryPathForConsult,
} from "../_shared/moffinQueryPaths.ts";
import {
  buildMoffinConsultFailErrorMessage,
  mapMoffinStatus,
  moffinMessageImpliesSatStillProcessing,
} from "../_shared/moffinReportStatus.ts";
import { resolveSatgoBearer, useSatgoForCsf32d } from "../_shared/satgoAuth.ts";
import {
  satgoFetchPdf,
  satgoKindFromConsultType,
  satgoServiceName,
} from "../_shared/satgoClient.ts";
import { uploadMoffinPdfFromBytes } from "../_shared/moffinPdfDownload.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AutoConsultType = "constancia_situacion_fiscal" | "opinion_cumplimiento";
const AUTO_CONSULT_TYPES: AutoConsultType[] = [
  "constancia_situacion_fiscal",
  "opinion_cumplimiento",
];

/** Máximo de consultas (cliente × tipo) por invocación para no agotar el tiempo de la Edge. */
const MAX_CONSULTS_PER_RUN = 40;

function firstDayOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function ensureProfileId(
  admin: SupabaseClient,
  clientId: string,
  rfc: string,
  ciecCiphertext: string,
  cachedProfileId: number | null,
  ciecSecret: string,
  solutionsBase: string,
  solutionsBearer: string,
  scheme: MoffinSolutionsAuthScheme,
): Promise<{ ok: true; profileId: number } | { ok: false; message: string }> {
  if (cachedProfileId != null) return { ok: true, profileId: cachedProfileId };
  let ciecPlain: string;
  try {
    ciecPlain = await decryptFielSecret(ciecCiphertext, ciecSecret);
  } catch (e) {
    return { ok: false, message: `CIEC ilegible: ${e instanceof Error ? e.message : String(e)}` };
  }
  const profRes = await moffinSolutionsPostJson(
    solutionsBase,
    solutionsBearer,
    moffinSolutionsProfilePath(),
    { rfc, ciec: ciecPlain },
    scheme,
  );
  if (!profRes.ok) return { ok: false, message: `Perfil SAT falló: ${profRes.message}` };
  const profileId = extractMoffinProfileId(profRes.json);
  if (profileId == null) return { ok: false, message: "Moffin no devolvió profileId." };
  await admin
    .from("moffin_client_sat_ciec")
    .update({ moffin_profile_id: profileId, updated_at: new Date().toISOString() })
    .eq("client_id", clientId);
  return { ok: true, profileId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const incoming = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (!cronSecret || !incoming || cronSecret !== incoming) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  const useSatgo = useSatgoForCsf32d();
  if (!useSatgo && getMoffinApiFlavor() !== "solutions") {
    return jsonResponse(
      { error: "requires_solutions_or_satgo", message: "Requiere SATgo o Moffin Solutions." },
      503,
    );
  }

  const ciecSecret =
    Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ||
    Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ||
    "";
  if (ciecSecret.length < 32) {
    return jsonResponse({ error: "ciec_not_configured" }, 503);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let solutionsBase = "";
  let solutionsBearer = "";
  let scheme: MoffinSolutionsAuthScheme = "Bearer";
  let satgoBearer = "";

  if (useSatgo) {
    const satAuth = await resolveSatgoBearer();
    if (!satAuth.ok) {
      return jsonResponse({ error: satAuth.code, message: satAuth.message }, 503);
    }
    satgoBearer = satAuth.bearer;
  } else {
    solutionsBase = moffinSolutionsBaseUrl();
    const solAuth = await resolveMoffinSolutionsBearer(solutionsBase);
    if (!solAuth.ok) {
      return jsonResponse({ error: "moffin_solutions_auth", message: solAuth.message }, 503);
    }
    solutionsBearer = solAuth.bearer;
    scheme = solAuth.scheme;
  }

  const { data: ciecRows, error: ciecErr } = await admin
    .from("moffin_client_sat_ciec")
    .select("organization_id, client_id, ciec_ciphertext, moffin_profile_id, clients(rfc)")
    .not("ciec_ciphertext", "is", null);
  if (ciecErr) return jsonResponse({ error: ciecErr.message }, 500);

  const monthStart = firstDayOfMonthIso();
  const results: Array<Record<string, unknown>> = [];
  let consultsDone = 0;
  const provider = useSatgo ? "satgo" : "moffin";

  for (const row of (ciecRows ?? []) as Array<{
    organization_id: string;
    client_id: string;
    ciec_ciphertext: string;
    moffin_profile_id: number | null;
    clients: { rfc: string | null } | null;
  }>) {
    if (consultsDone >= MAX_CONSULTS_PER_RUN) break;
    const rfc = row.clients?.rfc?.trim().toUpperCase().replace(/\s/g, "") ?? "";
    if (!rfc) {
      results.push({ clientId: row.client_id, skipped: "sin_rfc" });
      continue;
    }

    const { data: projRow } = await admin
      .from("projects")
      .select("id")
      .eq("client_id", row.client_id)
      .limit(1)
      .maybeSingle();
    if (!projRow?.id) {
      results.push({ clientId: row.client_id, skipped: "sin_proyecto" });
      continue;
    }
    const projectId = projRow.id;

    let profileId = row.moffin_profile_id ?? null;
    let ciecPlainCached: string | null = null;

    for (const consultType of AUTO_CONSULT_TYPES) {
      if (consultsDone >= MAX_CONSULTS_PER_RUN) break;

      const { count: existing } = await admin
        .from("moffin_consults")
        .select("id", { count: "exact", head: true })
        .eq("client_id", row.client_id)
        .eq("consult_type", consultType)
        .in("status", ["success", "pending"])
        .gte("created_at", monthStart);
      if ((existing ?? 0) > 0) {
        results.push({ clientId: row.client_id, consultType, skipped: "ya_consultado_este_mes" });
        continue;
      }

      if (useSatgo) {
        if (!ciecPlainCached) {
          try {
            ciecPlainCached = await decryptFielSecret(row.ciec_ciphertext, ciecSecret);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await admin.from("moffin_consults").insert({
              organization_id: row.organization_id,
              project_id: projectId,
              client_id: row.client_id,
              rfc,
              consult_type: consultType,
              moffin_service: satgoServiceName(satgoKindFromConsultType(consultType)),
              status: "error",
              error_message: `Origen: descarga mensual automática (SATgo). CIEC ilegible: ${msg}`.slice(
                0,
                500,
              ),
              raw_response: { _error: msg, _auto: true, provider: "satgo" },
              requested_by: null,
            });
            results.push({ clientId: row.client_id, consultType, status: "error", message: msg });
            consultsDone += 1;
            continue;
          }
        }

        const kind = satgoKindFromConsultType(consultType);
        const serviceName = satgoServiceName(kind);
        const pdfRes = await satgoFetchPdf({
          bearer: satgoBearer,
          rfc,
          ciec: ciecPlainCached!,
          kind,
        });

        if (!pdfRes.ok) {
          await admin.from("moffin_consults").insert({
            organization_id: row.organization_id,
            project_id: projectId,
            client_id: row.client_id,
            rfc,
            consult_type: consultType,
            moffin_service: serviceName,
            status: "error",
            error_message: `Origen: descarga mensual automática (SATgo). ${pdfRes.message}`.slice(
              0,
              500,
            ),
            raw_response: {
              provider: "satgo",
              kind,
              httpStatus: pdfRes.httpStatus,
              message: pdfRes.message,
              _auto: true,
            },
            requested_by: null,
          });
          results.push({
            clientId: row.client_id,
            consultType,
            status: "error",
            statusCode: pdfRes.httpStatus,
            provider: "satgo",
          });
          consultsDone += 1;
          continue;
        }

        const up = await uploadMoffinPdfFromBytes({
          admin,
          orgId: row.organization_id,
          projectId,
          clientId: row.client_id,
          uploadedBy: null,
          buf: pdfRes.buf,
          fileBase: consultType,
          documentDisplayName: `${consultType}_monthly_${Date.now()}`,
          documentType: consultType,
        });

        await admin.from("moffin_consults").insert({
          organization_id: row.organization_id,
          project_id: projectId,
          client_id: row.client_id,
          rfc,
          consult_type: consultType,
          moffin_service: serviceName,
          status: up.documentId ? "success" : "error",
          error_message: up.documentId
            ? null
            : `PDF SATgo sin guardar: ${up.failureReason ?? "desconocido"}`.slice(0, 500),
          summary: up.documentId
            ? `Descarga mensual SATgo · PDF listo (${pdfRes.buf.length} bytes)`
            : "Descarga mensual SATgo · error al guardar PDF",
          raw_response: {
            provider: "satgo",
            kind,
            httpStatus: pdfRes.httpStatus,
            pdfBytes: pdfRes.buf.length,
            _auto: true,
            storageFailure: up.failureReason,
          },
          document_id: up.documentId,
          requested_by: null,
        });
        results.push({
          clientId: row.client_id,
          consultType,
          status: up.documentId ? "success" : "error",
          provider: "satgo",
          documentId: up.documentId,
        });
        consultsDone += 1;
        continue;
      }

      const prof = await ensureProfileId(
        admin,
        row.client_id,
        rfc,
        row.ciec_ciphertext,
        profileId,
        ciecSecret,
        solutionsBase,
        solutionsBearer,
        scheme,
      );
      if (!prof.ok) {
        await admin.from("moffin_consults").insert({
          organization_id: row.organization_id,
          project_id: projectId,
          client_id: row.client_id,
          rfc,
          consult_type: consultType,
          moffin_service: consultType === "constancia_situacion_fiscal" ? "csf" : "compliance-opinion",
          status: "error",
          error_message: `Origen: descarga mensual automática. ${prof.message}`.slice(0, 500),
          raw_response: { _error: prof.message, _auto: true },
          requested_by: null,
        });
        results.push({ clientId: row.client_id, consultType, status: "error", message: prof.message });
        consultsDone += 1;
        continue;
      }
      profileId = prof.profileId;

      const satPath = moffinSolutionsQueryPathForConsult(consultType);
      const moffinService = moffinQueryServiceSegment(satPath);
      const satRes = await moffinSolutionsPostJson(
        solutionsBase,
        solutionsBearer,
        satPath,
        { rfc },
        scheme,
      );

      if (!satRes.ok) {
        await admin.from("moffin_consults").insert({
          organization_id: row.organization_id,
          project_id: projectId,
          client_id: row.client_id,
          rfc,
          consult_type: consultType,
          moffin_service: moffinService,
          status: "error",
          error_message: `Origen: descarga mensual automática (Moffin). ${satRes.message}`.slice(0, 500),
          raw_response: { _error: satRes.message, _status: satRes.status, _auto: true },
          requested_by: null,
        });
        results.push({ clientId: row.client_id, consultType, status: "error", statusCode: satRes.status });
        consultsDone += 1;
        continue;
      }

      const json = satRes.json;
      let status = mapMoffinStatus(String(json.status ?? ""));
      const queryId = extractSolutionsQueryId(json);
      if (moffinMessageImpliesSatStillProcessing(json)) status = "pending";
      else if (
        queryId &&
        status === "error" &&
        (json.status === undefined || String(json.status ?? "").trim() === "")
      ) {
        status = "pending";
      }
      const errorMessage =
        status === "fail" || status === "error" ? buildMoffinConsultFailErrorMessage(json) : null;

      await admin.from("moffin_consults").insert({
        organization_id: row.organization_id,
        project_id: projectId,
        client_id: row.client_id,
        rfc,
        consult_type: consultType,
        moffin_service: moffinService,
        status,
        error_message: errorMessage,
        summary: status === "pending" ? "Descarga mensual automática: en cola en Moffin." : null,
        raw_response: { ...json, _auto: true },
        moffin_query_id: queryId,
        moffin_uuid: typeof json.uuid === "string" ? json.uuid : null,
        requested_by: null,
      });
      results.push({ clientId: row.client_id, consultType, status, moffinQueryId: queryId });
      consultsDone += 1;
    }
  }

  console.log(`moffin-monthly-sat (${provider}): ${consultsDone} consultas, ${results.length} resultados.`);

  const ciecClientIds = new Set((ciecRows ?? []).map((r) => r.client_id));
  const { data: projClientRows } = await admin
    .from("projects")
    .select("client_id")
    .not("client_id", "is", null);
  const clientIdsWithProject = new Set(
    (projClientRows ?? []).map((r) => (r as { client_id: string }).client_id),
  );

  const missingResults: Array<Record<string, unknown>> = [];
  let ciecMissingNotified = 0;
  const { data: clientRows, error: clientErr } = await admin
    .from("clients")
    .select("id, name, organization_id, responsible_user_id")
    .eq("status", "activo")
    .not("responsible_user_id", "is", null);
  if (clientErr) {
    console.error("moffin-monthly-sat: clients select:", clientErr.message);
  } else {
    for (const c of (clientRows ?? []) as Array<{
      id: string;
      name: string | null;
      organization_id: string;
      responsible_user_id: string;
    }>) {
      if (ciecClientIds.has(c.id)) continue;
      if (!clientIdsWithProject.has(c.id)) continue;

      const { count: already } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("type", "moffin_ciec_missing")
        .eq("entity_id", c.id)
        .gte("created_at", monthStart);
      if ((already ?? 0) > 0) {
        missingResults.push({ clientId: c.id, skipped: "ya_notificado_este_mes" });
        continue;
      }

      const clientName = c.name?.trim() || "el cliente";
      const { error: notifErr } = await admin.from("notifications").insert({
        user_id: c.responsible_user_id,
        organization_id: c.organization_id,
        type: "moffin_ciec_missing",
        title: "Falta CIEC para descarga SAT automática",
        body:
          `${clientName} no tiene CIEC registrada, por lo que el sistema no puede descargar ` +
          `automáticamente su Constancia de Situación Fiscal ni su Opinión de Cumplimiento (32D) ` +
          `este mes. Captura la CIEC del cliente para activar la descarga mensual.`,
        entity_type: "client",
        entity_id: c.id,
        is_read: false,
      });
      if (notifErr) {
        missingResults.push({ clientId: c.id, error: notifErr.message });
        continue;
      }
      ciecMissingNotified += 1;
      missingResults.push({ clientId: c.id, notified: c.responsible_user_id });
    }
  }

  return jsonResponse({
    source: "cron-monthly",
    provider,
    triggered: consultsDone,
    clientsWithCiec: ciecRows?.length ?? 0,
    ciecMissingNotified,
    cappedAt: MAX_CONSULTS_PER_RUN,
    results,
    missingCiec: missingResults,
  });
});
