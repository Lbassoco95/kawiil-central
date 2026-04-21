/**
 * Reintento automático de consultas SAT (Moffin Solutions) cuando el upstream Nubarium reporta
 * errores transitorios documentados:
 *  - "CSF not found in the response from Nubarium"
 *  - "Error requesting CSF from Nubarium"
 *  - "32D not found in the response from Nubarium"
 *
 * Estado por consulta vive en `moffin_consults.raw_response._nubariumRetry` (sin migración):
 *   { count, lastAt, lastError, queryIds: [string] }
 *
 * `count` = número de reintentos ya realizados (excluye el POST original).
 * `BACKOFF_MS[count]` = espera mínima requerida ANTES del próximo reintento.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptFielSecret } from "./moffinFielCrypto.ts";
import {
  type MoffinSolutionsAuthScheme,
  extractMoffinProfileId,
  extractSolutionsQueryId,
  moffinSolutionsPostJson,
} from "./moffinSolutionsClient.ts";
import {
  moffinSolutionsProfilePath,
  moffinSolutionsQueryPathForConsult,
} from "./moffinQueryPaths.ts";
import { unwrapMoffinReportInner } from "./moffinSatRfc.ts";

type Admin = ReturnType<typeof createClient>;

export const NUBARIUM_RETRY_MAX = 2;
/** Espera entre intento `count` y `count+1` (índice = count). */
export const NUBARIUM_RETRY_BACKOFF_MS = [60_000, 300_000];

const NUBARIUM_PATTERNS: RegExp[] = [
  /not\s+found\s+in\s+the\s+response\s+from\s+nubarium/i,
  /error\s+requesting\s+(csf|32d|compliance[\s-]?opinion)\s+from\s+nubarium/i,
  /nubarium/i,
];

export type NubariumRetryState = {
  count: number;
  lastAt: string;
  lastError: string;
  queryIds: string[];
};

export type NubariumRetryConsultType =
  | "constancia_situacion_fiscal"
  | "opinion_cumplimiento";

export function isNubariumTransientError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return NUBARIUM_PATTERNS.some((rx) => rx.test(msg));
}

/** Lee `serviceQuery.response.errorMessage` (Solutions FAIL upstream). */
export function extractNubariumErrorFromReport(
  report: Record<string, unknown> | null | undefined,
): string | null {
  if (!report) return null;
  const inner = unwrapMoffinReportInner(report);
  const stUp = String(inner?.status ?? report?.status ?? "").toUpperCase();
  if (stUp !== "FAIL" && stUp !== "FAILED" && stUp !== "FAILURE") return null;
  const ir = inner?.response;
  if (!ir || typeof ir !== "object" || Array.isArray(ir)) return null;
  const e = (ir as Record<string, unknown>).errorMessage;
  if (typeof e !== "string") return null;
  const trimmed = e.trim();
  return isNubariumTransientError(trimmed) ? trimmed : null;
}

export function readNubariumRetryState(raw: unknown): NubariumRetryState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)._nubariumRetry;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  const count = typeof s.count === "number" && Number.isFinite(s.count) ? s.count : 0;
  const lastAt = typeof s.lastAt === "string" ? s.lastAt : "";
  const lastError = typeof s.lastError === "string" ? s.lastError : "";
  const queryIds = Array.isArray(s.queryIds)
    ? (s.queryIds.filter((x) => typeof x === "string") as string[])
    : [];
  return { count, lastAt, lastError, queryIds };
}

/**
 * ¿Está cumplido el backoff para iniciar el próximo reintento?
 *  - Si nunca se ha reintentado (state == null), procede ya.
 *  - Si count >= MAX, no se reintenta más.
 */
export function nubariumRetryDueNow(state: NubariumRetryState | null): boolean {
  if (!state) return true;
  if (state.count >= NUBARIUM_RETRY_MAX) return false;
  const idx = Math.min(state.count, NUBARIUM_RETRY_BACKOFF_MS.length - 1);
  const wait = NUBARIUM_RETRY_BACKOFF_MS[idx] ?? 0;
  const last = state.lastAt ? new Date(state.lastAt).getTime() : 0;
  return Date.now() >= last + wait;
}

export function bumpNubariumRetryState(
  prev: NubariumRetryState | null,
  errorMsg: string,
  newQueryId: string | null,
): NubariumRetryState {
  const queryIds = [...(prev?.queryIds ?? [])];
  if (newQueryId && !queryIds.includes(newQueryId)) queryIds.push(newQueryId);
  return {
    count: (prev?.count ?? 0) + 1,
    lastAt: new Date().toISOString(),
    lastError: errorMsg,
    queryIds,
  };
}

export type NubariumRetryAttemptArgs = {
  admin: Admin;
  ciecSecret: string;
  solutionsBase: string;
  solutionsBearer: string;
  solutionsAuthScheme: MoffinSolutionsAuthScheme;
  consultType: NubariumRetryConsultType;
  rfc: string;
  clientId: string;
};

export type NubariumRetryAttemptResult =
  | { ok: true; queryId: string | null; json: Record<string, unknown> }
  | { ok: false; message: string; status: number; json?: Record<string, unknown> };

/**
 * Re-lanza un POST a Moffin Solutions reusando la CIEC y profileId guardados.
 * No persiste estado: el caller decide cómo actualizar `moffin_consults`.
 */
export async function attemptNubariumRetryPost(
  args: NubariumRetryAttemptArgs,
): Promise<NubariumRetryAttemptResult> {
  const { data: ciecRow, error: ciecErr } = await args.admin
    .from("moffin_client_sat_ciec")
    .select("ciec_ciphertext, moffin_profile_id")
    .eq("client_id", args.clientId)
    .maybeSingle();
  if (ciecErr || !ciecRow?.ciec_ciphertext) {
    return {
      ok: false,
      status: 0,
      message: ciecErr?.message ?? "CIEC no disponible para reintento Nubarium",
    };
  }

  let ciecPlain: string;
  try {
    ciecPlain = await decryptFielSecret(
      ciecRow.ciec_ciphertext as string,
      args.ciecSecret,
    );
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message: `ciec_decrypt_failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let profileId: number | null =
    typeof ciecRow.moffin_profile_id === "number" ? ciecRow.moffin_profile_id : null;
  if (profileId == null) {
    const profRes = await moffinSolutionsPostJson(
      args.solutionsBase,
      args.solutionsBearer,
      moffinSolutionsProfilePath(),
      { rfc: args.rfc, ciec: ciecPlain },
      args.solutionsAuthScheme,
    );
    if (!profRes.ok) {
      return { ok: false, message: profRes.message, status: profRes.status };
    }
    profileId = extractMoffinProfileId(profRes.json);
    if (profileId != null) {
      await args.admin
        .from("moffin_client_sat_ciec")
        .update({ moffin_profile_id: profileId, updated_at: new Date().toISOString() })
        .eq("client_id", args.clientId);
    } else {
      return {
        ok: false,
        status: 422,
        message: "Moffin no devolvió profileId al re-crear el perfil SAT",
      };
    }
  }

  const path = moffinSolutionsQueryPathForConsult(args.consultType);
  const satRes = await moffinSolutionsPostJson(
    args.solutionsBase,
    args.solutionsBearer,
    path,
    { rfc: args.rfc },
    args.solutionsAuthScheme,
  );
  if (!satRes.ok) {
    return { ok: false, message: satRes.message, status: satRes.status, json: undefined };
  }
  return { ok: true, queryId: extractSolutionsQueryId(satRes.json), json: satRes.json };
}

/**
 * Convención de payload para `moffin_consults.raw_response` cuando se programa/ejecuta un retry.
 * Conserva el snapshot Moffin original como `_nubariumRetryFromReport` para auditoría.
 */
export function buildRetryRawResponse(
  prevRaw: unknown,
  retryState: NubariumRetryState,
  fromReport: Record<string, unknown> | null,
  newPostJson: Record<string, unknown>,
): Record<string, unknown> {
  const prev =
    prevRaw && typeof prevRaw === "object" && !Array.isArray(prevRaw)
      ? (prevRaw as Record<string, unknown>)
      : {};
  return {
    ...newPostJson,
    _nubariumRetry: retryState,
    _nubariumRetryFromReport: fromReport ?? null,
    _nubariumRetryPrev: {
      moffin_query_id: typeof prev.queryId === "string" ? prev.queryId : prev.id ?? null,
      _refreshedAt: prev._refreshedAt ?? null,
    },
  };
}

export function nubariumSecretFromEnv(): string {
  return (
    Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ||
    Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ||
    ""
  );
}

export type NubariumRetryDecision =
  | { retry: true; nubariumError: string; prevState: NubariumRetryState | null }
  | { retry: false; reason: string };

/**
 * Decide si conviene re-postear a Moffin Solutions ante un FAIL upstream Nubarium.
 * No realiza side effects: solo evalúa estado + ventana + secretos.
 */
export function decideNubariumRetry(args: {
  uiStatus: "success" | "fail" | "pending" | "error";
  consultType: string;
  usesSolutions: boolean;
  hasClientId: boolean;
  hasCiecSecret: boolean;
  rawResponse: unknown;
  report: Record<string, unknown>;
}): NubariumRetryDecision {
  if (args.uiStatus !== "fail" && args.uiStatus !== "error") {
    return { retry: false, reason: "status_not_fail" };
  }
  if (!args.usesSolutions) return { retry: false, reason: "not_solutions" };
  if (
    args.consultType !== "constancia_situacion_fiscal" &&
    args.consultType !== "opinion_cumplimiento"
  ) {
    return { retry: false, reason: "consult_type_not_eligible" };
  }
  if (!args.hasClientId) return { retry: false, reason: "missing_client_id" };
  if (!args.hasCiecSecret) return { retry: false, reason: "ciec_secret_unavailable" };
  const nubariumError = extractNubariumErrorFromReport(args.report);
  if (!nubariumError) return { retry: false, reason: "not_nubarium_transient" };
  const prevState = readNubariumRetryState(args.rawResponse);
  if (!nubariumRetryDueNow(prevState)) {
    return {
      retry: false,
      reason: prevState && prevState.count >= NUBARIUM_RETRY_MAX
        ? "retry_max_reached"
        : "retry_backoff_pending",
    };
  }
  return { retry: true, nubariumError, prevState };
}

/** Texto del summary que se persiste mientras un retry está en vuelo. */
export function nubariumRetrySummary(
  consultType: NubariumRetryConsultType,
  state: NubariumRetryState,
  nubariumError: string,
): string {
  const tag = consultType === "constancia_situacion_fiscal" ? "CSF" : "32D";
  return `${tag} (SAT) · reintento ${state.count}/${NUBARIUM_RETRY_MAX} tras Nubarium: ${nubariumError}`;
}
