import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MX_TZ = "America/Mexico_City";

/**
 * Franjas horarias soportadas. El cron dispara dos veces al día (≈08:00 y
 * ≈15:00 CDMX) y la función decide si toca `morning` o `afternoon` según la
 * hora local. Permite override vía `time_of_day` en el body para pruebas
 * manuales desde el dashboard.
 */
const MORNING_HOURS = { start: 7, end: 14 } as const; // [07:00, 15:00)
const AFTERNOON_HOURS = { start: 14, end: 22 } as const; // [14:00, 22:00)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

function ymdMexico(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MX_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function resolveTimeOfDay(
  hour: number,
  override?: string | null,
): "morning" | "afternoon" | null {
  if (override === "morning" || override === "afternoon") return override;
  if (hour >= MORNING_HOURS.start && hour < MORNING_HOURS.end) return "morning";
  if (hour >= AFTERNOON_HOURS.start && hour < AFTERNOON_HOURS.end) return "afternoon";
  return null;
}

type PhraseRequestBody = {
  user_id: string;
  time_of_day: "morning" | "afternoon";
  force_regenerate: boolean;
  mood_score: number | null;
  tasks_pending: number | null;
  completed_today: number | null;
  overdue_count: number | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Autenticación: el cron de Postgres pasa `x-cron-secret`. Para invocaciones
    // manuales (e.g. desde el dashboard) aceptamos también el bearer estándar de
    // service role.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const headerSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const cronOk = !!cronSecret && headerSecret === cronSecret;
    const bearerOk = !!bearer && (bearer === serviceRoleKey || bearer.length > 16);

    if (!cronOk && !bearerOk) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as {
      time_of_day?: "morning" | "afternoon";
      force_regenerate?: boolean;
    };

    const { hour, weekday } = getMexicoTimeInfo();
    const isWeekend = weekday === "Sat" || weekday === "Sun";

    if (isWeekend) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "weekend", hour, weekday }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const timeOfDay = resolveTimeOfDay(hour, body.time_of_day);
    if (!timeOfDay) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: "outside_refresh_windows",
          hour,
          weekday,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const todayYmd = ymdMexico();

    const { data: users, error: usersError } = await adminClient
      .from("profiles")
      .select("user_id")
      .eq("is_active", true)
      .not("user_id", "is", null);

    if (usersError) throw usersError;

    const uniqueUserIds = Array.from(
      new Set((users ?? []).map((u) => u.user_id).filter(Boolean)),
    ) as string[];

    const results: Array<{ user_id: string; ok: boolean; error?: string; status?: number }> = [];

    for (const userId of uniqueUserIds) {
      try {
        // Contexto del día por usuario para que la frase del cron sea
        // realmente motivadora "conforme a lo que se analiza al día de hoy".
        const [pendingRes, completedRes, overdueRes, moodRes] = await Promise.all([
          adminClient
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("assigned_to", userId)
            .in("status", ["pendiente", "en_progreso", "en_revision"]),
          adminClient
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("assigned_to", userId)
            .eq("status", "completada")
            .gte("updated_at", `${todayYmd}T00:00:00-06:00`)
            .lt("updated_at", `${todayYmd}T23:59:59-06:00`),
          adminClient
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("assigned_to", userId)
            .in("status", ["pendiente", "en_progreso", "en_revision"])
            .lt("due_date", todayYmd),
          adminClient
            .from("mood_checkins")
            .select("mood")
            .eq("user_id", userId)
            .eq("check_date", todayYmd)
            .eq("time_of_day", timeOfDay)
            .maybeSingle(),
        ]);

        const requestBody: PhraseRequestBody = {
          user_id: userId,
          time_of_day: timeOfDay,
          force_regenerate: body.force_regenerate ?? false,
          mood_score: (moodRes.data as { mood?: number } | null)?.mood ?? null,
          tasks_pending: pendingRes.count ?? null,
          completed_today: completedRes.count ?? null,
          overdue_count: overdueRes.count ?? null,
        };

        const resp = await fetch(`${supabaseUrl}/functions/v1/generate-phrase`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          results.push({
            user_id: userId,
            ok: false,
            status: resp.status,
            error: errText.slice(0, 300),
          });
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
        time_of_day: timeOfDay,
        hour,
        weekday,
        total_users: uniqueUserIds.length,
        success,
        failed,
        failures: results.filter((r) => !r.ok).slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
      },
    );
  }
});
