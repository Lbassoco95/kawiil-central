import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SlackMethod =
  | "conversations.list"
  | "conversations.history"
  | "chat.postMessage"
  | "users.info";

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
      return new Response(JSON.stringify({ error: "slack_not_connected", message: "Conecta Slack primero." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await req.json().catch(() => ({}));
    const action = json.action as string;

    if (action === "conversations.list") {
      const types = (json.types as string) || "public_channel,private_channel,mpim,im";
      const cursor = json.cursor as string | undefined;
      const limit = (json.limit as number) || 200;
      const data = await slackCall(conn.access_token, "conversations.list", {
        types,
        cursor,
        limit,
      });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "conversations.history") {
      const channel = json.channel as string;
      if (!channel) {
        return new Response(JSON.stringify({ error: "channel required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await slackCall(conn.access_token, "conversations.history", {
        channel,
        cursor: json.cursor as string | undefined,
        limit: (json.limit as number) || 50,
        inclusive: "true",
      });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "chat.postMessage") {
      const channel = json.channel as string;
      const text = json.text as string;
      if (!channel || !text?.trim()) {
        return new Response(JSON.stringify({ error: "channel and text required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await slackCall(conn.access_token, "chat.postMessage", {
        channel,
        text: text.trim(),
        thread_ts: json.thread_ts as string | undefined,
      });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "users.info.batch") {
      const rawIds = json.user_ids as unknown;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return new Response(JSON.stringify({ error: "user_ids array required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const unique = [...new Set(rawIds.map((x) => String(x)).filter(Boolean))].slice(0, 80);
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

      return new Response(JSON.stringify({ ok: true, users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        error: "unknown_action",
        allowed: ["conversations.list", "conversations.history", "chat.postMessage", "users.info.batch"],
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("slack-api:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
