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
) {
  const form = new FormData();
  form.append("channels", channel);
  form.append("filename", filename);
  form.append("file", new Blob([bytes]), filename);
  if (initialComment?.trim()) form.append("initial_comment", initialComment.trim());
  const res = await fetch("https://slack.com/api/files.upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.json() as Record<string, unknown>;
}

type SlackMethod =
  | "conversations.list"
  | "conversations.open"
  | "conversations.history"
  | "conversations.members"
  | "conversations.replies"
  | "conversations.info"
  | "chat.postMessage"
  | "chat.scheduleMessage"
  | "users.info"
  | "users.list";

const MAX_UPLOAD_BYTES = 52 * 1024 * 1024;

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
): Promise<Record<string, unknown>> {
  const ext = await slackFilesUploadExternal(token, channel, filename, bytes, initialComment);
  if (ext.ok === true) return ext as Record<string, unknown>;
  const err = String((ext as { error?: string }).error || "");
  if (err.includes("missing_scope")) return ext as Record<string, unknown>;
  const classic = await slackFilesUploadClassic(token, channel, filename, bytes, initialComment);
  return annotateSlackResponse(classic);
}

async function slackCall(token: string, method: SlackMethod, params: Record<string, string | number | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, String(v));
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return res.json();
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
      json = { action: String(multipart.get("action") || "") };
    } else {
      json = await req.json().catch(() => ({}));
    }

    const action = json.action as string;

    if (action === "files.upload" && multipart) {
      const channel = String(multipart.get("channel") || "");
      const filename = String(multipart.get("filename") || "upload");
      const initialComment = multipart.get("initial_comment")?.toString();
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
      const data = await slackFilesUploadWithFallback(conn.access_token, channel, name, binary, initialComment);
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

    if (action === "conversations.open") {
      const users = (json.users as string)?.trim();
      if (!users) {
        return jsonOk({ ok: false, error: "users required (Slack user IDs, comma-separated for grupos)" });
      }
      const data = await slackCall(conn.access_token, "conversations.open", {
        users: users.replace(/\s+/g, ""),
      });
      return jsonOk(data);
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
      const data = await slackCall(conn.access_token, "conversations.history", {
        channel,
        cursor: json.cursor as string | undefined,
        limit: (json.limit as number) || 50,
        inclusive: "true",
      });
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
      const data = await slackCall(conn.access_token, "conversations.replies", {
        channel,
        ts,
        cursor: json.cursor as string | undefined,
        limit: (json.limit as number) || 50,
        inclusive: "true",
      });
      return jsonOk(data);
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
        text: text.trim(),
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
        text: text.trim(),
        post_at: postAt,
        thread_ts: json.thread_ts as string | undefined,
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

    if (action === "files.upload") {
      const channel = json.channel as string;
      const filename = (json.filename as string) || "upload";
      const base64 = json.base64 as string;
      const initialComment = json.initial_comment as string | undefined;
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
      const data = await slackFilesUploadWithFallback(conn.access_token, channel, filename, binary, initialComment);
      return jsonOk(data);
    }

    if (action === "users.info.batch") {
      const rawIds = json.user_ids as unknown;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return jsonOk({ ok: false, error: "user_ids array required" });
      }
      const unique = [...new Set(rawIds.map((x) => String(x)).filter(Boolean))].slice(0, 200);
      const users: Record<string, { display_name: string | null; real_name: string | null; avatar_url: string | null }> = {};

      const chunk = 8;
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
        "conversations.open",
        "users.list",
        "conversations.history",
        "conversations.members",
        "conversations.members.batch",
        "conversations.replies",
        "conversations.info",
        "chat.postMessage",
        "chat.scheduleMessage",
        "users.profile.set",
        "files.upload",
        "users.info.batch",
      ],
    });
  } catch (error) {
    console.error("slack-api:", error);
    return jsonOk({ ok: false, error: (error as Error).message });
  }
});
