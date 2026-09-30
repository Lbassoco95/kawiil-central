import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type LinkedAccountMeta = {
  id: string;
  provider: "microsoft" | "google" | "imap";
  email: string | null;
  display_name: string | null;
  status: "connected" | "error" | "disconnected";
  calendar_enabled: boolean;
  mail_enabled: boolean;
  last_error: string | null;
  last_sync_at: string | null;
  updated_at: string;
};

type SlackMeta = {
  connected: boolean;
  broken: boolean;
  updated_at: string | null;
};

type MicrosoftPrincipalMeta = {
  connected: boolean;
  expires_at: string | null;
  updated_at: string | null;
};

type UserIntegrationHealth = {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string | null;
  slack: SlackMeta;
  microsoft_principal: MicrosoftPrincipalMeta;
  linked_accounts: LinkedAccountMeta[];
  issue_count: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: isAdmin } = await adminClient.rpc("is_admin_or_manager", {
      _user_id: callerUser.id,
    });
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden", message: "Solo administradores pueden consultar el estado de integraciones." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: orgId } = await adminClient.rpc("get_user_org_id", {
      _user_id: callerUser.id,
    });
    if (!orgId) throw new Error("Could not determine organization");

    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("user_id, full_name, email, avatar_url")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("full_name");
    if (profilesError) throw profilesError;

    const userIds = (profiles ?? []).map((p) => p.user_id);
    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ users: [], counts: { total: 0, slack_broken: 0, slack_missing: 0, microsoft_missing: 0, linked_account_errors: 0, users_with_issues: 0 }, generated_at: new Date().toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const [{ data: roles }, { data: slackRows }, { data: msRows }, { data: linkedRows }] = await Promise.all([
      adminClient.from("user_roles").select("user_id, role").in("user_id", userIds),
      adminClient
        .from("user_slack_connections")
        .select("user_id, slack_status_broken_at, updated_at")
        .in("user_id", userIds),
      adminClient
        .from("microsoft_tokens")
        .select("user_id, expires_at, updated_at")
        .in("user_id", userIds),
      adminClient
        .from("linked_accounts")
        .select(
          "id, user_id, provider, email, display_name, status, calendar_enabled, mail_enabled, last_error, last_sync_at, updated_at",
        )
        .in("user_id", userIds),
    ]);

    const roleMap = new Map<string, string>();
    (roles ?? []).forEach((r: any) => roleMap.set(r.user_id, r.role));

    const slackMap = new Map<string, { broken_at: string | null; updated_at: string | null }>();
    (slackRows ?? []).forEach((s: any) => slackMap.set(s.user_id, { broken_at: s.slack_status_broken_at, updated_at: s.updated_at }));

    const msMap = new Map<string, { expires_at: string | null; updated_at: string | null }>();
    (msRows ?? []).forEach((m: any) => msMap.set(m.user_id, { expires_at: m.expires_at, updated_at: m.updated_at }));

    const linkedByUser = new Map<string, LinkedAccountMeta[]>();
    (linkedRows ?? []).forEach((l: any) => {
      const list = linkedByUser.get(l.user_id) ?? [];
      list.push({
        id: l.id,
        provider: l.provider,
        email: l.email,
        display_name: l.display_name,
        status: l.status,
        calendar_enabled: l.calendar_enabled,
        mail_enabled: l.mail_enabled,
        last_error: l.last_error,
        last_sync_at: l.last_sync_at,
        updated_at: l.updated_at,
      });
      linkedByUser.set(l.user_id, list);
    });

    const now = new Date().toISOString();

    const users: UserIntegrationHealth[] = (profiles ?? []).map((p: any) => {
      const slack = slackMap.get(p.user_id);
      const slackMeta: SlackMeta = {
        connected: !!slack,
        broken: !!slack?.broken_at,
        updated_at: slack?.updated_at ?? null,
      };

      const ms = msMap.get(p.user_id);
      const msMeta: MicrosoftPrincipalMeta = {
        connected: !!ms,
        expires_at: ms?.expires_at ?? null,
        updated_at: ms?.updated_at ?? null,
      };

      const linked = linkedByUser.get(p.user_id) ?? [];

      let issueCount = 0;
      if (!slackMeta.connected) issueCount++;
      else if (slackMeta.broken) issueCount++;
      if (!msMeta.connected) issueCount++;
      for (const acc of linked) {
        if (acc.status !== "connected") issueCount++;
      }

      return {
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        role: roleMap.get(p.user_id) ?? null,
        slack: slackMeta,
        microsoft_principal: msMeta,
        linked_accounts: linked,
        issue_count: issueCount,
      };
    });

    const counts = {
      total: users.length,
      slack_broken: users.filter((u) => u.slack.broken).length,
      slack_missing: users.filter((u) => !u.slack.connected).length,
      microsoft_missing: users.filter((u) => !u.microsoft_principal.connected).length,
      linked_account_errors: users.reduce(
        (sum, u) => sum + u.linked_accounts.filter((a) => a.status !== "connected").length,
        0,
      ),
      users_with_issues: users.filter((u) => u.issue_count > 0).length,
    };

    return new Response(
      JSON.stringify({ users, counts, generated_at: now }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("integration-health error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
