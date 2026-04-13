import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PhraseRequest = {
  force_regenerate?: boolean;
  mood_score?: number | null;
  time_of_day?: "morning" | "afternoon";
  user_id?: string;
};

const MX_TZ = "America/Mexico_City";
const DAILY_REFRESH_HOUR = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
/** Mismo modelo que ai-chat / process-document (Haiku a veces falla o no está habilitado en la cuenta). Override: secreto opcional GENERATE_PHRASE_ANTHROPIC_MODEL. */
function phraseAnthropicModel(): string {
  return (Deno.env.get("GENERATE_PHRASE_ANTHROPIC_MODEL") || "").trim() ||
    "claude-sonnet-4-20250514";
}

function parseAnthropicErrorBody(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    const m = j.error?.message;
    if (m) return m.replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    /* ignore */
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429, 529 (Anthropic overloaded) u overload en cuerpo. */
function isTransientAnthropicFailure(status: number, detail: string): boolean {
  if (status === 429 || status === 529) return true;
  if (/overload/i.test(detail)) return true;
  if (status === 503 && /overload/i.test(detail)) return true;
  return false;
}

const FALLBACK_QUOTES = [
  "La disciplina tarde o temprano vencerá a la inteligencia.\n— Yukio Mishima, Sol y acero",
  "No cuentes los días, haz que los días cuenten.\n— Muhammad Ali, Entrevistas",
  "La mejor manera de predecir el futuro es creándolo.\n— Peter Drucker, Managing for Results",
  "Hazlo con pasión o cambia de proyecto.\n— Rosa Montero, Entrevistas",
];

function getMexicoCalendarParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MX_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    day: Number(map.day),
    hour: Number(map.hour),
    month: Number(map.month),
    year: Number(map.year),
  };
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousBusinessDay(date: Date): Date {
  const previous = new Date(date);
  do {
    previous.setUTCDate(previous.getUTCDate() - 1);
  } while (previous.getUTCDay() === 0 || previous.getUTCDay() === 6);
  return previous;
}

function resolvePhraseDateForSchedule(now = new Date()): string {
  const { year, month, day, hour } = getMexicoCalendarParts(now);
  const mxDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = mxDate.getUTCDay();
  const weekend = weekday === 0 || weekday === 6;

  if (weekend || hour < DAILY_REFRESH_HOUR) {
    return formatUtcDate(previousBusinessDay(mxDate));
  }

  return formatUtcDate(mxDate);
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["“”'’]/g, "")
    .trim();
}

function parsePhrase(rawPhrase: string): string {
  if (rawPhrase.startsWith("FRASE:")) {
    return rawPhrase.replace(/^FRASE:\s*/i, "").trim();
  }
  return rawPhrase.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: PhraseRequest = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const requesterClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userErr } = await requesterClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const dbClient = requesterClient;
    const moodScore = payload.mood_score ?? null;
    const forceRegenerate = payload.force_regenerate ?? false;
    const timeOfDay = payload.time_of_day === "afternoon" ? "afternoon" : "morning";
    const phraseDate = resolvePhraseDateForSchedule(new Date());

    if (!forceRegenerate) {
      const { data: existing } = await dbClient
        .from("personalized_phrases")
        .select("phrase")
        .eq("user_id", userId)
        .eq("phrase_date", phraseDate)
        .eq("time_of_day", timeOfDay)
        .maybeSingle();

      if (existing?.phrase) {
        return new Response(
          JSON.stringify({
            cached: true,
            phrase: existing.phrase,
            phrase_date: phraseDate,
            time_of_day: timeOfDay,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const [{ data: prefs }, { data: profile }, { data: recentPhrases }] = await Promise.all([
      dbClient
        .from("user_preferences")
        .select("answers")
        .eq("user_id", userId)
        .maybeSingle(),
      dbClient
        .from("profiles")
        .select("full_name, area, organization_id")
        .eq("user_id", userId)
        .maybeSingle(),
      dbClient
        .from("personalized_phrases")
        .select("phrase")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const firstName = profile?.full_name?.split(" ")[0] || "compañero";
    const answers = (prefs?.answers ?? {}) as Record<string, string>;

    const recentPhraseList = (recentPhrases ?? [])
      .map((entry) => entry.phrase)
      .filter(Boolean);
    const recentPhraseSet = new Set(recentPhraseList.map(normalizePhrase));

    let personalContext = "";
    if (Object.keys(answers).length > 0) {
      personalContext = `
PERFIL CULTURAL DEL USUARIO:
- Género literario favorito: ${answers.libro_genero || "no especificado"}
- Libro/autor favorito: ${answers.libro_favorito || "no especificado"}
- Género musical favorito: ${answers.musica_genero || "no especificado"}
- Artista/banda favorita: ${answers.musica_artista || "no especificado"}
- Género de series/películas: ${answers.tv_genero || "no especificado"}
- Serie/película favorita: ${answers.tv_favorita || "no especificado"}
- Hobby o actividad favorita: ${answers.hobby || "no especificado"}
- Qué le motiva más: ${answers.motivacion || "no especificado"}
- Tipo de humor: ${answers.humor || "no especificado"}
- Personaje inspirador: ${answers.personaje_inspirador || "no especificado"}
- Lugar favorito: ${answers.lugar_favorito || "no especificado"}
- Valor más importante: ${answers.valor_importante || "no especificado"}

Usa estas preferencias para personalizar la frase con referencias sutiles a sus gustos.`;
    }

    const moodContext =
      moodScore != null
        ? `\nÁNIMO ACTUAL: ${moodScore}/5 (${moodScore <= 2 ? "bajo — necesita apoyo y empatía" : moodScore <= 3 ? "neutral — motivar suavemente" : "alto — reforzar energía positiva"})`
        : "";

    const blockedQuotes =
      recentPhraseList.length > 0
        ? recentPhraseList.map((phrase, index) => `${index + 1}. ${phrase.replace(/\s+/g, " ").slice(0, 220)}`).join("\n")
        : "Sin citas previas recientes.";

    const basePrompt = `Selecciona UNA frase o cita REAL y EXISTENTE que motive a ${firstName}, basándote en sus gustos culturales.
Momento del día: ${timeOfDay === "afternoon" ? "tarde" : "mañana"}.
Fecha objetivo de frase (CDMX): ${phraseDate}.
${moodContext}
${personalContext}

INSTRUCCIONES:
1. La frase DEBE SER una cita real de un personaje, autor, músico, película, serie, libro o figura pública.
2. ${Object.keys(answers).length > 0 ? "Elige citas relacionadas con sus gustos." : "Elige una cita célebre motivacional de alguna figura reconocida."}
3. Máximo 2 líneas la cita.
4. Incluye atribución: quién lo dijo y de dónde viene.
5. NO inventes frases.
6. Evita repetir textualmente cualquiera de estas citas recientes:\n${blockedQuotes}
7. Formato EXACTO:
FRASE: [la cita textual]
— [Autor/Personaje], [Fuente/Obra]`;

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message:
            "IA no configurada: define el secreto ANTHROPIC_API_KEY en el proyecto Supabase (Edge Functions) para generar frases personalizadas.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    async function requestAiPhrase(prompt: string) {
      const maxFetchAttempts = 5;
      for (let fetchAttempt = 0; fetchAttempt < maxFetchAttempts; fetchAttempt += 1) {
        const aiResp = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: phraseAnthropicModel(),
            max_tokens: 512,
            system:
              "Eres un curador cultural experto. Solo compartes citas auténticas, verificables y con atribución completa. Nunca inventas frases y no repites citas recientes del historial.",
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          const raw =
            aiData.content?.find?.((b: { type?: string; text?: string }) => b.type === "text")?.text?.trim() ||
            "";
          return (
            raw ||
            "FRASE: Hazlo o no lo hagas, pero no lo intentes.\n— Yoda, Star Wars: El Imperio Contraataca"
          );
        }

        const text = await aiResp.text();
        const detail = parseAnthropicErrorBody(text);
        console.error("Anthropic error:", aiResp.status, detail);

        if (aiResp.status === 401 || aiResp.status === 403) {
          throw new Error("AI_AUTH_ERROR");
        }

        const transient = isTransientAnthropicFailure(aiResp.status, detail);
        if (transient && fetchAttempt < maxFetchAttempts - 1) {
          const delay = Math.min(8000, 500 * 2 ** fetchAttempt) + Math.floor(Math.random() * 300);
          await sleep(delay);
          continue;
        }

        if (aiResp.status === 429) {
          throw new Error("RATE_LIMIT");
        }
        throw new Error(`AI_PROVIDER_ERROR|${detail}`);
      }
      throw new Error("AI_PROVIDER_ERROR|Overloaded");
    }

    let phrase = "";
    let generated = false;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const attemptPrompt =
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANTE: En tu intento anterior repetiste una cita del historial. Elige otra diferente.`;

        const rawPhrase = await requestAiPhrase(attemptPrompt);
        const parsedPhrase = parsePhrase(rawPhrase);

        if (!recentPhraseSet.has(normalizePhrase(parsedPhrase))) {
          phrase = parsedPhrase;
          generated = true;
          break;
        }

        phrase = parsedPhrase;
      }
    } catch (phraseLoopErr) {
      const msg = phraseLoopErr instanceof Error ? phraseLoopErr.message : "";
      const overload =
        msg.startsWith("AI_PROVIDER_ERROR|") &&
        /overload/i.test(msg.slice("AI_PROVIDER_ERROR|".length));
      if (overload) {
        const nonRepeatedFallback = FALLBACK_QUOTES.find(
          (candidate) => !recentPhraseSet.has(normalizePhrase(candidate))
        );
        phrase = nonRepeatedFallback ?? FALLBACK_QUOTES[0] ?? phrase;
        generated = true;
      } else {
        throw phraseLoopErr;
      }
    }

    if (!generated) {
      const nonRepeatedFallback = FALLBACK_QUOTES.find(
        (candidate) => !recentPhraseSet.has(normalizePhrase(candidate))
      );
      phrase = nonRepeatedFallback ?? phrase;
    }

    await adminClient.from("personalized_phrases").upsert(
      {
        user_id: userId,
        organization_id: profile?.organization_id,
        phrase,
        phrase_date: phraseDate,
        time_of_day: timeOfDay,
        mood_score: moodScore,
      },
      { onConflict: "user_id,phrase_date,time_of_day" }
    );

    return new Response(
      JSON.stringify({
        cached: false,
        phrase,
        phrase_date: phraseDate,
        time_of_day: timeOfDay,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Unknown error";

    if (errorMessage === "RATE_LIMIT") {
      return new Response(
        JSON.stringify({ error: "Demasiadas solicitudes. Intenta en unos minutos." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (errorMessage === "AI_AUTH_ERROR") {
      return new Response(
        JSON.stringify({
          error: "ai_auth_error",
          message: "La clave de Anthropic no es válida o no tiene permisos. Revisa ANTHROPIC_API_KEY en Supabase.",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (errorMessage.startsWith("AI_PROVIDER_ERROR")) {
      const detail = errorMessage.startsWith("AI_PROVIDER_ERROR|")
        ? errorMessage.slice("AI_PROVIDER_ERROR|".length).trim()
        : "";
      return new Response(
        JSON.stringify({
          error: "ai_provider_error",
          message: detail
            ? detail
            : "El proveedor de IA devolvió un error. Intenta de nuevo más tarde.",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.error("generate-phrase error:", e);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
