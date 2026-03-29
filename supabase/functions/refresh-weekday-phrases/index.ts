import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MX_TZ = "America/Mexico_City";
const MIN_REFRESH_HOUR = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getMexicoTimeInfo(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MX_TZ,
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    hour: Number(map.hour),
    weekday: map.weekday,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();

    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hour, weekday } = getMexicoTimeInfo();
    const isWeekend = weekday === "Sat" || weekday === "Sun";

    if (isWeekend || hour < MIN_REFRESH_HOUR) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: isWeekend ? "weekend" : "before_refresh_hour",
          hour,
          weekday,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: users, error: usersError } = await adminClient
      .from("profiles")
      .select("user_id")
      .eq("is_active", true)
      .not("user_id", "is", null);

    if (usersError) {
      throw usersError;
    }

    const uniqueUserIds = Array.from(new Set((users ?? []).map((u) => u.user_id).filter(Boolean)));

    const results: Array<{ user_id: string; ok: boolean; error?: string }> = [];

    for (const userId of uniqueUserIds) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/generate-phrase`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: userId,
            time_of_day: "morning",
            force_regenerate: false,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          results.push({ user_id: userId, ok: false, error: errText.slice(0, 300) });
          continue;
        }

        results.push({ user_id: userId, ok: true });
      } catch (error) {
        results.push({
          user_id: userId,
          ok: false,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    const success = results.filter((r) => r.ok).length;
    const failed = results.length - success;

    return new Response(
      JSON.stringify({
        skipped: false,
        total_users: uniqueUserIds.length,
        success,
        failed,
        failures: results.filter((r) => !r.ok).slice(0, 10),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("refresh-weekday-phrases error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
