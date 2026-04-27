import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** HTTP 200 siempre que sea posible: el cliente Supabase `invoke` solo expone el cuerpo si la respuesta es 2xx. */
function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Incluye `needed` de Slack en el texto de error para el toast del cliente. */
function annotateSlackResponse(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.ok === false && obj.error === "missing_scope" && obj.needed != null) {
    const need = Array.isArray(obj.needed) ? (obj.needed as unknown[]).join(", ") : String(obj.needed);
    return {
      ...obj,
      error: `missing_scope — scopes requeridos: ${need}`,
    };
  }
  return obj;
}

/**
 * Subida clásica files.upload (multipart). Misma familia de permisos que el flujo externo;
 * algunos workspaces aún la aceptan cuando el flujo externo falla por formato de subida.
 */
async function slackFilesUploadClassic(
  token: string,
  channel: string,
  filename: string,
  bytes: Uint8Array,
  initialComment?: string,
  threadTs?: string,
) {
  const form = new FormData();
  form.append("channels", channel);
  form.append("filename", filename);
  form.append("file", new Blob([bytes]), filename);
  if (initialComment?.trim()) form.append("initial_comment", initialComment.trim());
  if (threadTs?.trim()) form.append("thread_ts", threadTs.trim());
  const res = await fetch("https://slack.com/api/files.upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.json() as Record<string, unknown>;
}

type SlackMethod =
  | "conversations.list"
  | "conversations.join"
  | "conversations.mark"
  | "conversations.open"
  | "conversations.history"
  | "conversations.members"
  | "conversations.replies"
  | "conversations.info"
  | "chat.postMessage"
  | "chat.scheduleMessage"
  | "chat.update"
  | "chat.delete"
  | "reactions.add"
  | "reactions.remove"
  | "users.info"
  | "users.list"
  | "auth.test";

const MAX_UPLOAD_BYTES = 52 * 1024 * 1024;
const MAX_PRIVATE_FILE_FETCH_BYTES = 20 * 1024 * 1024;
const SLACK_HTTP_TIMEOUT_MS = 25_000;

/**
 * Negritas estilo Markdown (**texto**) → mrkdwn de Slack (*texto*).
 * Slack no interpreta **; sin esto el cliente muestra los asteriscos literales.
 */
function markdownBoldToSlackMrkdwn(text: string): string {
  return text.replace(/\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, "*$1*");
}

/**
 * Presupuesto total por invocación `conversations.history` (join + varios history).
 * Debe cubrir ~4 tramos de SLACK_HTTP_TIMEOUT_MS; si es demasiado bajo, se abortan
 * recuperaciones ante `not_in_channel` y el cliente se queda cargando hasta timeout.
 */
const SLACK_HISTORY_HANDLER_BUDGET_MS = 115_000;

/** Presupuesto para reunir todas las páginas de `conversations.replies` en una sola respuesta. */
const SLACK_THREAD_REPLIES_BUDGET_MS = 45_000;
const SLACK_THREAD_REPLIES_MAX_PAGES = 25;
const SLACK_THREAD_REPLIES_MAX_MESSAGES = 2500;

/**
 * Flujo recomendado por Slack (sustituye files.upload clásico, a menudo rechazado o limitado).
 * 1) getUploadURLExternal 2) PUT binario 3) completeUploadExternal
 */
async function slackFilesUploadExternal(
  token: string,
  channel: string,
  filename: string,
  bytes: Uint8Array,
  initialComment?: string,
  threadTs?: string,
) {
  const step1Params = new URLSearchParams({
    filename,
    length: String(bytes.byteLength),
  });
  const gRes = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: step1Params,
  });
  const gu = await gRes.json() as {
    ok?: boolean;
    error?: string;
    needed?: string;
    upload_url?: string;
    file_id?: string;
  };
  if (!gu.ok || !gu.upload_url || !gu.file_id) {
    return annotateSlackResponse(gu as Record<string, unknown>);
  }

  // Slack documenta POST multipart al upload_url (p. ej. curl -F file=@...); PUT en crudo a veces falla.
  const upForm = new FormData();
  upForm.append("file", new Blob([bytes]), filename);
  let upRes = await fetch(gu.upload_url, { method: "POST", body: upForm });
  if (!upRes.ok) {
    upRes = await fetch(gu.upload_url, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  if (!upRes.ok) {
    return { ok: false, error: `upload_to_slack_url_failed_${upRes.status}` };
  }

  const completePayload: Record<string, unknown> = {
    channel_id: channel,
    files: [{ id: gu.file_id, title: filename }],
  };
  if (initialComment?.trim()) completePayload.initial_comment = initialComment.trim();
  if (threadTs?.trim()) completePayload.thread_ts = threadTs.trim();

  let cRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(completePayload),
  });
  let completed = await cRes.json() as Record<string, unknown>;

  if (completed.ok === false && completed.error === "invalid_arguments") {
    const comp = new URLSearchParams();
    comp.set("channel_id", channel);
    comp.set("files", JSON.stringify([{ id: gu.file_id, title: filename }]));
    comp.set("channels", channel);
    if (initialComment?.trim()) comp.set("initial_comment", initialComment.trim());
    if (threadTs?.trim()) comp.set("thread_ts", threadTs.trim());
    cRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: comp,
    });
    completed = await cRes.json() as Record<string, unknown>;
  }

  const errCode = String(completed.error || "");
  if (
    completed.ok === false &&
    (errCode === "channel_not_found" || errCode === "invalid_channel")
  ) {
    const alt: Record<string, unknown> = {
      channels: channel,
      files: [{ id: gu.file_id, title: filename }],
    };
    if (initialComment?.trim()) alt.initial_comment = initialComment.trim();
    if (threadTs?.trim()) alt.thread_ts = threadTs.trim();
    cRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(alt),
    });
    completed = await cRes.json() as Record<string, unknown>;
  }

  return annotateSlackResponse(completed);
}

/** Si el flujo externo falla por algo distinto de permisos, intenta files.upload clásico. */
async function slackFilesUploadWithFallback(
  token: string,
  channel: string,
  filename: string,
  bytes: Uint8Array,
  initialComment?: string,
  threadTs?: string,
): Promise<Record<string, unknown>> {
  const comment =
    initialComment?.trim() ? markdownBoldToSlackMrkdwn(initialComment.trim()) : undefined;
  const ext = await slackFilesUploadExternal(token, channel, filename, bytes, comment, threadTs);
  if (ext.ok === true) return ext as Record<string, unknown>;
  const err = String((ext as { error?: string }).error || "");
  if (err.includes("missing_scope")) return ext as Record<string, unknown>;
  const classic = await slackFilesUploadClassic(token, channel, filename, bytes, comment, threadTs);
  return annotateSlackResponse(classic);
}

async function slackCall(token: string, method: SlackMethod, params: Record<string, string | number | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, String(v));
  }
  const sleepRate = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const maxRateRetries = 2;

  for (let rateAttempt = 0; rateAttempt <= maxRateRetries; rateAttempt++) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), SLACK_HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 0;
        if (rateAttempt < maxRateRetries) {
          const ms = retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : 2000 * (rateAttempt + 1);
          await sleepRate(ms);
          continue;
        }
        return { ok: false, error: "slack_http_429" };
      }
      if (!res.ok) {
        return { ok: false, error: `slack_http_${res.status}` };
      }
      const json = await res.json() as { ok?: boolean; error?: string; retry_after?: number };
      if (json && json.ok === false && (json.error === "ratelimited" || json.error === "rate_limited") &&
        rateAttempt < maxRateRetries) {
        const ra = Number(json.retry_after) || 0;
        const ms = ra > 0 ? Math.min(60_000, (ra + 1) * 1000) : 2000 * (rateAttempt + 1);
        await sleepRate(ms);
        continue;
      }
      return json;
    } catch (e) {
      const abortName =
        e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : "";
      if (abortName === "AbortError") {
        return { ok: false, error: "slack_timeout" };
      }
      return { ok: false, error: "slack_network_error" };
    } finally {
      clearTimeout(tid);
    }
  }
  return { ok: false, error: "ratelimited" };
}

function slackHistoryBudgetLeftMs(startedAt: number): number {
  return SLACK_HISTORY_HANDLER_BUDGET_MS - (Date.now() - startedAt);
}

/** Evita encadenar otra llamada a Slack si no cabe un margen razonable antes del presupuesto total. */
function slackHistoryCanAttemptRecovery(startedAt: number): boolean {
  return slackHistoryBudgetLeftMs(startedAt) > SLACK_HTTP_TIMEOUT_MS + 2_000;
}

type SlackRepliesPage = {
  ok?: boolean;
  messages?: Array<Record<string, unknown>>;
  has_more?: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
};

function sortSlackMessagesByTs(messages: Array<Record<string, unknown>>): void {
  messages.sort((a, b) => {
    const ta = parseFloat(String(a.ts ?? "0"));
    const tb = parseFloat(String(b.ts ?? "0"));
    return ta - tb;
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function slackUnreadSnapshot(
  token: string,
  maxPages = 15,
): Promise<{
  ok: boolean;
  unread_by_channel: Record<string, number>;
  channels_total: number;
  slack_error?: string;
}> {
  const unreadByChannel: Record<string, number> = {};
  let cursor: string | undefined;
  let channelsTotal = 0;

  for (let i = 0; i < maxPages; i++) {
    const data = await slackCall(token, "conversations.list", {
      types: "public_channel,private_channel,mpim,im",
      limit: 1000,
      cursor,
    }) as {
      ok?: boolean;
      channels?: Array<{ id?: string; unread_count?: number; unread_count_display?: number }>;
      response_metadata?: { next_cursor?: string };
      error?: string;
    };

    if (!data.ok) {
      return {
        ok: false,
        unread_by_channel: {},
        channels_total: channelsTotal,
        slack_error: typeof data.error === "string" ? data.error : undefined,
      };
    }

    for (const ch of data.channels || []) {
      if (!ch?.id) continue;
      channelsTotal += 1;
      const unread = Number(ch.unread_count_display ?? ch.unread_count ?? 0);
      unreadByChannel[ch.id] = Number.isFinite(unread) && unread > 0 ? unread : 0;
    }

    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }

  return {
    ok: true,
    unread_by_channel: unreadByChannel,
    channels_total: channelsTotal,
  };
}

/** Estima no leídos por canal con conversations.history (oldest = último ts visto en Kawiil). */
async function slackUnreadHistoryBatch(
  token: string,
  readState: Record<string, string>,
  channelIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const ids = [...new Set(channelIds.map((x) => String(x).trim()).filter(Boolean))].slice(0, 24);
  const skipSubtype = new Set([
    "channel_join",
    "channel_leave",
    "channel_topic",
    "channel_purpose",
    "channel_archive",
    "channel_unarchive",
  ]);

  const fetchOne = async (channelId: string) => {
    const oldest = readState[channelId]?.trim();
    if (!oldest) {
      out[channelId] = 0;
      return;
    }
    const data = await slackCall(token, "conversations.history", {
      channel: channelId,
      oldest,
      limit: 100,
      inclusive: "false",
    }) as {
      ok?: boolean;
      error?: string;
      messages?: Array<{ ts?: string; subtype?: string }>;
    };
    if (!data.ok) {
      console.warn("conversations.history unread batch:", channelId, data.error);
      out[channelId] = 0;
      return;
    }
    let n = 0;
    for (const m of data.messages || []) {
      if (!m?.ts) continue;
      if (m.subtype && skipSubtype.has(m.subtype)) continue;
      n += 1;
    }
    out[channelId] = Math.min(99, n);
  };

  const CONCURRENCY = 3;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const slice = ids.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map((id) => fetchOne(id)));
  }
  return out;
}

/** users.profile.set requiere `profile` como JSON en el cuerpo form-urlencoded. */
async function slackUsersProfileSet(token: string, profile: Record<string, unknown>) {
  const body = new URLSearchParams();
  body.set("profile", JSON.stringify(profile));
  const res = await fetch("https://slack.com/api/users.profile.set", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return annotateSlackResponse(data);
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: conn, error: connErr } = await supabaseAdmin
      .from("user_slack_connections")
      .select("access_token, slack_team_id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connErr || !conn?.access_token) {
      return jsonOk({ ok: false, error: "slack_not_connected", message: "Conecta Slack primero." });
    }

    const ct = req.headers.get("content-type") || "";
    let json: Record<string, unknown> = {};
    let multipart: FormData | null = null;

    if (ct.includes("multipart/form-data")) {
      multipart = await req.formData();
      json = { action: String(multipart.get("action") || "").trim() };
    } else {
      json = await req.json().catch(() => ({}));
    }

    const action = String(json.action ?? "").trim();

    if (action === "files.upload" && multipart) {
      const channel = String(multipart.get("channel") || "");
      const filename = String(multipart.get("filename") || "upload");
      const initialComment = multipart.get("initial_comment")?.toString();
      const threadTsRaw = multipart.get("thread_ts")?.toString();
      const threadTs = threadTsRaw?.trim() || undefined;
      const file = multipart.get("file");
      if (!channel) {
        return jsonOk({ ok: false, error: "channel required" });
      }
      if (!(file instanceof File)) {
        return jsonOk({ ok: false, error: "file required" });
      }
      const buf = await file.arrayBuffer();
      const binary = new Uint8Array(buf);
      if (binary.byteLength > MAX_UPLOAD_BYTES) {
        return jsonOk({ ok: false, error: "file too large (max ~50MB)" });
      }
           const name = filename || file.name || "upload";
      const data = await slackFilesUploadWithFallback(
        conn.access_token,
        channel,
        name,
        binary,
        initialComment,
        threadTs,
      );
      return jsonOk(data);
    }

    if (multipart && action !== "files.upload") {
      return jsonOk({ ok: false, error: "multipart_only_supported_for_files.upload" });
    }

    if (action === "conversations.list") {
      const types = (json.types as string) || "public_channel,private_channel,mpim,im";
      const cursor = json.cursor as string | undefined;
      const rawLimit = (json.limit as number) || 200;
      const limit = Math.min(1000, Math.max(1, rawLimit));
      const data = await slackCall(conn.access_token, "conversations.list", {
        types,
        cursor,
        limit,
      });
      return jsonOk(data);
    }

    if (action === "conversations.join") {
      const channel = (json.channel as string)?.trim();
      if (!channel) {
        return jsonOk({ ok: false, error: "channel required" });
      }
      const data = await slackCall(conn.access_token, "conversations.join", {
        channel,
      });
      return jsonOk(data);
    }

    if (action === "conversations.open") {
      const users = (json.users as string)?.trim();
      const resumeChannel = (json.channel as string)?.trim();
      /** Reanudar DM / MPIM existente por id (Slack documenta `channel` para retomar conversación). */
      if (resumeChannel && !users) {
        const data = await slackCall(conn.access_token, "conversations.open", {
          channel: resumeChannel,
        });
        return jsonOk(data);
      }
      if (!users) {
        return jsonOk({
          ok: false,
          error: "users or channel required (users=… para nuevo DM/grupo; channel=id para reanudar)",
        });
      }
      const data = await slackCall(conn.access_token, "conversations.open", {
        users: users.replace(/\s+/g, ""),
      });
      return jsonOk(data);
    }

    if (action === "conversations.mark") {
      const channel = (json.channel as string)?.trim();
      const ts = (json.ts as string | undefined)?.trim();
      if (!channel) {
        return jsonOk({ ok: false, error: "channel required" });
      }
      const data = await slackCall(conn.access_token, "conversations.mark", {
        channel,
        ts,
      });
      return jsonOk(data);
    }

    if (action === "conversations.unread.snapshot") {
      const rawIds = json.channel_ids as unknown;
      const readState =
        json.read_state && typeof json.read_state === "object" && json.read_state !== null
          ? (json.read_state as Record<string, string>)
          : {};
      if (Array.isArray(rawIds) && rawIds.length > 0) {
        const channelIds = [...new Set(rawIds.map((x) => String(x)).filter(Boolean))].slice(0, 18);
        /** Secuencial: menos ráfagas concurrentes a Slack (rate limits / cierres de sesión). */
        const fromHist = await slackUnreadHistoryBatch(conn.access_token, readState, channelIds);
        const listSnap = await slackUnreadSnapshot(conn.access_token, 8);
        const tokenFatal = new Set([
          "invalid_auth",
          "token_revoked",
          "account_inactive",
          "not_allowed_token",
        ]);
        if (listSnap.ok === false && listSnap.slack_error && tokenFatal.has(listSnap.slack_error)) {
          return jsonOk({
            ok: false,
            error: listSnap.slack_error,
            message: "El acceso de Slack dejó de ser válido. Vuelve a conectar desde Comunicación.",
            unread_by_channel: {},
          });
        }
        const merged: Record<string, number> = { ...fromHist };
        for (const [k, v] of Object.entries(listSnap.unread_by_channel)) {
          merged[k] = Math.max(merged[k] || 0, v);
        }
        return jsonOk({
          ok: true,
          unread_by_channel: merged,
          channels_total: channelIds.length,
        });
      }
      const legacy = await slackUnreadSnapshot(conn.access_token, 15);
      return jsonOk(legacy);
    }

    if (action === "users.list") {
      const cursor = json.cursor as string | undefined;
      const rawLimit = (json.limit as number) || 200;
      const limit = Math.min(1000, Math.max(1, rawLimit));
      const data = await slackCall(conn.access_token, "users.list", {
        cursor,
        limit,
      });
      return jsonOk(data);
    }

    if (action === "conversations.history") {
      const channel = json.channel as string;
      if (!channel) {
        return jsonOk({ ok: false, error: "channel required" });
      }
      const historyBudgetStart = Date.now();
      const cursor = (json.cursor as string | undefined)?.trim() || undefined;
      const latest = (json.latest as string | undefined)?.trim() || undefined;
      const oldest = (json.oldest as string | undefined)?.trim() || undefined;
      const histParams: Record<string, string | number | undefined> = {
        channel,
        limit: (json.limit as number) || 50,
        inclusive: "true",
      };
      if (cursor) histParams.cursor = cursor;
      if (latest) histParams.latest = latest;
      if (oldest) histParams.oldest = oldest;
      let data = await slackCall(conn.access_token, "conversations.history", histParams);
      // Canales públicos: a veces aparecen en lista pero el user token no está joined.
      if (
        data?.ok === false && data?.error === "not_in_channel" && channel.startsWith("C") &&
        slackHistoryCanAttemptRecovery(historyBudgetStart)
      ) {
        const joined = await slackCall(conn.access_token, "conversations.join", { channel });
        if (joined?.ok && slackHistoryBudgetLeftMs(historyBudgetStart) > 3_000) {
          data = await slackCall(conn.access_token, "conversations.history", histParams);
        }
        // Algunos workspaces requieren además "reanudar" la conversación para este user token.
        if (
          data?.ok === false && data?.error === "not_in_channel" &&
          slackHistoryCanAttemptRecovery(historyBudgetStart)
        ) {
          const reopened = await slackCall(conn.access_token, "conversations.open", { channel });
          if (reopened?.ok && slackHistoryBudgetLeftMs(historyBudgetStart) > 3_000) {
            data = await slackCall(conn.access_token, "conversations.history", histParams);
          }
        }
      }
      // MPIM / DM / privado (G…, D…): `not_in_channel` suele resolverse reabriendo la conversación.
      if (
        data?.ok === false && data?.error === "not_in_channel" && (channel.startsWith("G") || channel.startsWith("D")) &&
        slackHistoryCanAttemptRecovery(historyBudgetStart)
      ) {
        const reopened = await slackCall(conn.access_token, "conversations.open", { channel });
        if (reopened?.ok && slackHistoryBudgetLeftMs(historyBudgetStart) > 3_000) {
          data = await slackCall(conn.access_token, "conversations.history", histParams);
        }
      }
      return jsonOk(data);
    }

    if (action === "conversations.members") {
      const channel = json.channel as string;
      if (!channel) {
        return jsonOk({ ok: false, error: "channel required" });
      }
      const data = await slackCall(conn.access_token, "conversations.members", {
        channel,
        cursor: json.cursor as string | undefined,
        limit: (json.limit as number) || 200,
      });
      return jsonOk(data);
    }

    if (action === "conversations.members.batch") {
      const raw = json.channel_ids as unknown;
      if (!Array.isArray(raw) || raw.length === 0) {
        return jsonOk({ ok: false, error: "channel_ids array required" });
      }
      const ids = [...new Set(raw.map((x) => String(x)).filter(Boolean))].slice(0, 40);
      const members_by_channel: Record<string, string[]> = {};
      for (const ch of ids) {
        const data = await slackCall(conn.access_token, "conversations.members", {
          channel: ch,
          limit: 100,
        });
        if (data.ok && Array.isArray(data.members)) {
          members_by_channel[ch] = data.members as string[];
        } else {
          members_by_channel[ch] = [];
        }
      }
      return jsonOk({ ok: true, members_by_channel });
    }

    if (action === "conversations.replies") {
      const channel = json.channel as string;
      const ts = json.ts as string;
      if (!channel || !ts) {
        return jsonOk({ ok: false, error: "channel and ts required" });
      }
      const rawLimit = typeof json.limit === "number" ? json.limit : 50;
      const maxTotal = Math.min(SLACK_THREAD_REPLIES_MAX_MESSAGES, Math.max(1, rawLimit));
      const clientCursor = (json.cursor as string | undefined)?.trim() || undefined;

      // Modo compat: el cliente pasa `cursor` explícito → una sola página (sin fusión automática).
      if (clientCursor) {
        const perPage = Math.min(1000, Math.max(1, maxTotal));
        const data = await slackCall(conn.access_token, "conversations.replies", {
          channel,
          ts,
          cursor: clientCursor,
          limit: perPage,
          inclusive: "true",
        });
        return jsonOk(data);
      }

      const threadStarted = Date.now();
      const merged: Array<Record<string, unknown>> = [];
      const seenTs = new Set<string>();
      let nextCursor: string | undefined;
      let lastMeta: { next_cursor?: string } | undefined;
      let lastHasMore = false;

      for (let page = 0; page < SLACK_THREAD_REPLIES_MAX_PAGES; page++) {
        if (Date.now() - threadStarted > SLACK_THREAD_REPLIES_BUDGET_MS) break;
        if (merged.length >= maxTotal) break;

        const remaining = maxTotal - merged.length;
        const perPage = Math.min(200, Math.max(1, remaining));
        const data = (await slackCall(conn.access_token, "conversations.replies", {
          channel,
          ts,
          cursor: nextCursor,
          limit: perPage,
          inclusive: "true",
        })) as SlackRepliesPage;

        if (!data.ok) {
          if (page === 0) return jsonOk(data);
          break;
        }

        for (const m of data.messages || []) {
          const tsk = m && typeof m.ts === "string" ? m.ts : "";
          if (!tsk || seenTs.has(tsk)) continue;
          seenTs.add(tsk);
          merged.push(m);
          if (merged.length >= maxTotal) break;
        }

        lastMeta = data.response_metadata;
        lastHasMore = data.has_more === true;
        nextCursor = data.response_metadata?.next_cursor?.trim() || undefined;
        if (!lastHasMore || !nextCursor) break;
      }

      sortSlackMessagesByTs(merged);
      return jsonOk({
        ok: true,
        messages: merged,
        has_more: lastHasMore && !!nextCursor && merged.length < maxTotal,
        response_metadata: lastMeta?.next_cursor
          ? { next_cursor: lastMeta.next_cursor }
          : undefined,
      });
    }

    if (action === "conversations.info") {
      const channel = json.channel as string;
      if (!channel) {
        return jsonOk({ ok: false, error: "channel required" });
      }
      const data = await slackCall(conn.access_token, "conversations.info", {
        channel,
      });
      return jsonOk(data);
    }

    if (action === "chat.postMessage") {
      const channel = json.channel as string;
      const text = json.text as string;
      if (!channel || !text?.trim()) {
        return jsonOk({ ok: false, error: "channel and text required" });
      }
      const data = await slackCall(conn.access_token, "chat.postMessage", {
        channel,
        text: markdownBoldToSlackMrkdwn(text.trim()),
        thread_ts: json.thread_ts as string | undefined,
      });
      return jsonOk(data);
    }

    if (action === "chat.scheduleMessage") {
      const channel = json.channel as string;
      const text = json.text as string;
      const postAtRaw = json.post_at as number | string | undefined;
      const postAt = typeof postAtRaw === "string" ? parseInt(postAtRaw, 10) : postAtRaw;
      if (!channel || !text?.trim() || postAt == null || Number.isNaN(postAt)) {
        return jsonOk({ ok: false, error: "channel, text and post_at required" });
      }
      const data = await slackCall(conn.access_token, "chat.scheduleMessage", {
        channel,
        text: markdownBoldToSlackMrkdwn(text.trim()),
        post_at: postAt,
        thread_ts: json.thread_ts as string | undefined,
      });
      return jsonOk(data);
    }

    if (action === "chat.update") {
      const channel = json.channel as string;
      const ts = json.ts as string;
      const text = json.text as string;
      if (!channel || !ts?.trim() || !text?.trim()) {
        return jsonOk({ ok: false, error: "channel, ts and text required" });
      }
      const data = await slackCall(conn.access_token, "chat.update", {
        channel,
        ts: ts.trim(),
        text: markdownBoldToSlackMrkdwn(text.trim()),
      });
      return jsonOk(annotateSlackResponse(data as Record<string, unknown>));
    }

    if (action === "chat.delete") {
      const channel = json.channel as string;
      const ts = json.ts as string;
      if (!channel || !ts?.trim()) {
        return jsonOk({ ok: false, error: "channel and ts required" });
      }
      const data = await slackCall(conn.access_token, "chat.delete", {
        channel,
        ts: ts.trim(),
      });
      return jsonOk(annotateSlackResponse(data as Record<string, unknown>));
    }

    if (action === "auth.test") {
      // Diagnóstico: devuelve identidad + scopes del token de usuario actual.
      // Slack devuelve los scopes efectivos en el header `x-oauth-scopes` de la respuesta.
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "",
      });
      const data = await res.json().catch(() => ({ ok: false, error: "parse_error" }));
      const scopesHeader =
        res.headers.get("x-oauth-scopes") || res.headers.get("X-OAuth-Scopes") || "";
      const scopes = scopesHeader
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return jsonOk({
        ...data,
        _kawiil: {
          scopes,
          has_reactions_write: scopes.includes("reactions:write"),
          has_reactions_read: scopes.includes("reactions:read"),
        },
      });
    }

    if (action === "reactions.add" || action === "reactions.remove") {
      const channel = json.channel as string;
      const ts = json.ts as string;
      let name = String(json.name || "").trim();
      name = name.replace(/^:|:$/g, "");
      if (!channel || !ts || !name) {
        return jsonOk({ ok: false, error: "channel, ts and name required" });
      }
      const method = action === "reactions.add" ? "reactions.add" : "reactions.remove";
      const data = await slackCall(conn.access_token, method, {
        channel,
        timestamp: ts,
        name,
      });
      return jsonOk(data);
    }

    if (action === "users.profile.set") {
      const clear = json.clear_status === true;
      const profileRaw = json.profile as Record<string, unknown> | undefined;
      if (clear) {
        const data = await slackUsersProfileSet(conn.access_token, {
          status_text: "",
          status_emoji: "",
          status_expiration: 0,
        });
        return jsonOk(data);
      }
      if (!profileRaw || typeof profileRaw !== "object") {
        return jsonOk({ ok: false, error: "profile object required, or clear_status: true" });
      }
      const data = await slackUsersProfileSet(conn.access_token, profileRaw);
      return jsonOk(data);
    }

    if (action === "files.fetch_private") {
      const url = (json.url as string | undefined)?.trim();
      if (!url || !url.startsWith("https://")) {
        return jsonOk({ ok: false, error: "valid https url required" });
      }

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
        },
      });

      if (!res.ok) {
        return jsonOk({ ok: false, error: `file_fetch_failed_${res.status}` });
      }

      const contentLength = Number(res.headers.get("content-length") || "0");
      if (contentLength > MAX_PRIVATE_FILE_FETCH_BYTES) {
        return jsonOk({ ok: false, error: "file too large for inline fetch" });
      }

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength > MAX_PRIVATE_FILE_FETCH_BYTES) {
        return jsonOk({ ok: false, error: "file too large for inline fetch" });
      }

      const contentType = res.headers.get("content-type") || "application/octet-stream";
      const base64 = uint8ToBase64(bytes);
      return jsonOk({
        ok: true,
        content_type: contentType,
        size: bytes.byteLength,
        base64,
      });
    }

    if (action === "files.upload") {
      const channel = json.channel as string;
      const filename = (json.filename as string) || "upload";
      const base64 = json.base64 as string;
      const initialComment = json.initial_comment as string | undefined;
      const threadTs = (json.thread_ts as string | undefined)?.trim() || undefined;
      if (!channel || !base64?.length) {
        return jsonOk({ ok: false, error: "channel and base64 required" });
      }
      let binary: Uint8Array;
      try {
        binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      } catch {
        return jsonOk({ ok: false, error: "invalid base64" });
      }
      if (binary.byteLength > MAX_UPLOAD_BYTES) {
        return jsonOk({ ok: false, error: "file too large (max ~50MB)" });
      }
      const data = await slackFilesUploadWithFallback(
        conn.access_token,
        channel,
        filename,
        binary,
        initialComment,
        threadTs,
      );
      return jsonOk(data);
    }

    if (action === "users.info.batch") {
      const rawIds = json.user_ids as unknown;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return jsonOk({ ok: false, error: "user_ids array required" });
      }
      const unique = [...new Set(rawIds.map((x) => String(x)).filter(Boolean))].slice(0, 200);
      const users: Record<string, { display_name: string | null; real_name: string | null; avatar_url: string | null }> = {};

      const chunk = 4;
      for (let i = 0; i < unique.length; i += chunk) {
        const part = unique.slice(i, i + chunk);
        await Promise.all(
          part.map(async (slackUserId) => {
            const data = await slackCall(conn.access_token, "users.info", { user: slackUserId });
            if (data.ok && data.user) {
              const u = data.user as {
                profile?: { display_name?: string; real_name?: string; image_72?: string };
                real_name?: string;
              };
              const dn = u.profile?.display_name?.trim() || null;
              const rn = u.profile?.real_name?.trim() || u.real_name?.trim() || null;
              users[slackUserId] = {
                display_name: dn,
                real_name: rn,
                avatar_url: u.profile?.image_72 || null,
              };
            }
          }),
        );
      }

      return jsonOk({ ok: true, users });
    }

    return jsonOk({
      ok: false,
      error: "unknown_action",
      allowed: [
        "conversations.list",
        "conversations.join",
        "conversations.open",
        "conversations.mark",
        "conversations.unread.snapshot",
        "users.list",
        "conversations.history",
        "conversations.members",
        "conversations.members.batch",
        "conversations.replies",
        "conversations.info",
        "chat.postMessage",
        "chat.scheduleMessage",
        "chat.update",
        "chat.delete",
        "users.profile.set",
        "files.fetch_private",
        "files.upload",
        "users.info.batch",
      ],
    });
  } catch (error) {
    console.error("slack-api:", error);
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "string" && error.trim()
          ? error.trim()
          : "slack_function_error";
    return jsonOk({ ok: false, error: msg });
  }
});
