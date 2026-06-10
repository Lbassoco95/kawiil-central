import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PhraseModule = "tareas" | "clientes";

type PhraseRequest = {
  force_regenerate?: boolean;
  mood_score?: number | null;
  time_of_day?: "morning" | "afternoon";
  user_id?: string;
  /** Tareas (default — mantiene compatibilidad con dashboard). */
  tasks_pending?: number | null;
  completed_today?: number | null;
  overdue_count?: number | null;
  /** Módulo del que se pide la frase. Default `tareas`. */
  module?: PhraseModule;
  /** Contexto específico del módulo (e.g. para `clientes`: activos, al_corriente, requieren_atencion, onboarding). */
  module_context?: Record<string, unknown>;
};

/** Devuelve la cache key (`time_of_day` extendido) para que módulos distintos no
 * compartan la misma frase del día sin necesidad de migrar el unique index.
 * El sufijo `-v2` invalida frases del módulo `clientes` previamente cacheadas
 * con prompts antiguos que devolvían citas fuera de eje (e.g. Marx). */
function moduleCacheSlot(timeOfDay: "morning" | "afternoon", module: PhraseModule): string {
  if (module === "tareas") return timeOfDay;
  if (module === "clientes") return `${timeOfDay}-clientes-v2`;
  return `${timeOfDay}-${module}`;
}

/**
 * Lista de "citas demasiado obvias" que la IA tiende a repetir cuando hay perfil
 * cultural disponible. Las bloqueamos para forzar conexión real con preferencias.
 */
const GENERIC_QUOTES_BLOCKLIST = [
  "los problemas no pueden resolverse en el mismo nivel de conciencia en el que fueron creados",
  "la mejor manera de predecir el futuro es creandolo",
  "la mejor manera de predecir el futuro es crearlo",
  "se el cambio que quieres ver en el mundo",
  "el unico modo de hacer un gran trabajo es amar lo que haces",
  "la vida es lo que te pasa mientras estas ocupado haciendo otros planes",
  "no cuentes los dias haz que los dias cuenten",
  "lo unico que tenemos que temer es al miedo mismo",
];

/** Campos del cuestionario v1 (legacy) sobre los que rotamos el foco diario. */
const PREFERENCE_FOCUS_KEYS_V1 = [
  "personaje_inspirador",
  "libro_favorito",
  "musica_artista",
  "tv_favorita",
  "valor_importante",
  "hobby",
  "motivacion",
] as const;

/** Campos del cuestionario v2 (nuevo diseño 2026). */
const PREFERENCE_FOCUS_KEYS_V2 = [
  "figuras_inspiradoras",
  "obra_favorita",
  "deporte",
  "equipo_artista",
  "meta_anio",
  "hobbies",
] as const;

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
    "claude-sonnet-4-6";
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

function parsePhrase(rawPhrase: string): { text: string; confidence: "alta" | "media" | "original" } {
  let cleaned = rawPhrase.trim();
  if (cleaned.startsWith("FRASE:")) {
    cleaned = cleaned.replace(/^FRASE:\s*/i, "").trim();
  }
  // Strip anything after a --- separator (AI sometimes adds reflection paragraphs)
  cleaned = cleaned.replace(/\n\s*---[\s\S]*/i, "").trim();
  // Strip Confianza line anywhere it appears
  cleaned = cleaned.replace(/\nConfianza:[^\n]*/gi, "").trim();
  // Strip Conecta con line anywhere it appears
  cleaned = cleaned.replace(/\nConecta con:[^\n]*/gi, "").trim();
  // Strip markdown italics/bold: *text* → text, **text** → text
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");

  let confidence: "alta" | "media" | "original" = "media";
  // Re-check for inline Confianza in case it was on the same line
  const confMatch = rawPhrase.match(/Confianza:\s*(alta|media|original)/i);
  if (confMatch) {
    confidence = confMatch[1].toLowerCase() as "alta" | "media" | "original";
  }

  return { text: cleaned.trim(), confidence };
}

/** Convierte un valor de respuesta (string o array) a string para el prompt. */
function answerStr(v: unknown): string {
  if (Array.isArray(v)) return (v as string[]).join(", ");
  return typeof v === "string" ? v : "";
}

/** Construye el bloque PERFIL CULTURAL según el formato del cuestionario (v1 legacy o v2 nuevo). */
function buildPersonalContext(answers: Record<string, unknown>): string {
  const isV2 = "hobbies" in answers || "figuras_inspiradoras" in answers;
  if (isV2) {
    const excluir = answerStr(answers.excluir_temas);
    const tonoS = answerStr(answers.tono_serio_divertido) || "3";
    const tonoL = answerStr(answers.tono_corto_largo) || "3";
    return `
PERFIL CULTURAL DEL USUARIO (v2):
- Hobbies / actividades favoritas: ${answerStr(answers.hobbies) || "no especificado"}
- Deporte o actividad física: ${answerStr(answers.deporte) || "no especificado"}
- Equipo deportivo o artista favorito: ${answerStr(answers.equipo_artista) || "no especificado"}
- Figuras que le inspiran: ${answerStr(answers.figuras_inspiradoras) || "no especificado"}
- Obra favorita (libro/serie/podcast): ${answerStr(answers.obra_favorita) || "no especificado"}
- Meta personal este año: ${answerStr(answers.meta_anio) || "no especificado"}
- Tipo de mensaje preferido: ${answerStr(answers.tipo_mensaje) || "no especificado"}
- Tono (1=muy serio, 5=muy divertido): ${tonoS}/5
- Extensión (1=corto y directo, 5=con contexto): ${tonoL}/5${excluir ? `\n- ⚠️ TEMAS EXCLUIDOS (no incluir): ${excluir}` : ""}`;
  }
  // Formato legacy v1
  return `
PERFIL CULTURAL DEL USUARIO:
- Género literario favorito: ${answerStr(answers.libro_genero) || "no especificado"}
- Libro/autor favorito: ${answerStr(answers.libro_favorito) || "no especificado"}
- Género musical favorito: ${answerStr(answers.musica_genero) || "no especificado"}
- Artista/banda favorita: ${answerStr(answers.musica_artista) || "no especificado"}
- Género de series/películas: ${answerStr(answers.tv_genero) || "no especificado"}
- Serie/película favorita: ${answerStr(answers.tv_favorita) || "no especificado"}
- Hobby o actividad favorita: ${answerStr(answers.hobby) || "no especificado"}
- Qué le motiva más: ${answerStr(answers.motivacion) || "no especificado"}
- Tipo de humor: ${answerStr(answers.humor) || "no especificado"}
- Personaje inspirador: ${answerStr(answers.personaje_inspirador) || "no especificado"}
- Lugar favorito: ${answerStr(answers.lugar_favorito) || "no especificado"}
- Valor más importante: ${answerStr(answers.valor_importante) || "no especificado"}`;
}

/**
 * Selecciona un campo del cuestionario disponible para usar como "foco" del día.
 * Rotamos por fecha + usuario para que cada persona reciba un foco distinto en el mismo día.
 * Soporta tanto el formato v1 (strings) como v2 (strings o arrays).
 */
function pickPreferenceFocus(
  answers: Record<string, unknown>,
  phraseDate: string,
  userId: string,
): { key: string; value: string } | null {
  const isV2 = "hobbies" in answers || "figuras_inspiradoras" in answers;
  const keys: readonly string[] = isV2 ? PREFERENCE_FOCUS_KEYS_V2 : PREFERENCE_FOCUS_KEYS_V1;
  const available = keys.filter((k) => {
    const str = answerStr(answers[k]);
    return str.trim().length > 0 && !/no especificado|no leo|no tengo|otro$/i.test(str);
  });
  if (available.length === 0) return null;
  const dateSeed = phraseDate.split("-").reduce((acc, part) => acc + Number(part || 0), 0);
  // UUID del usuario en el seed para que el foco sea distinto por persona en el mismo día.
  const userSeed = userId.replace(/-/g, "").slice(0, 8).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const key = available[(dateSeed + userSeed) % available.length];
  return { key, value: answerStr(answers[key]) };
}

function describeMood(score: number): string {
  if (score <= 2) return "bajo — necesita apoyo y empatía, evita exigirle más";
  if (score <= 3) return "neutral — motivar suavemente, sin presión";
  return "alto — reforzar energía positiva y celebrar";
}

function buildJourneyContext(payload: PhraseRequest): string {
  const module: PhraseModule = payload.module === "clientes" ? "clientes" : "tareas";

  if (module === "clientes") {
    const ctx = (payload.module_context ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    const num = (k: string): number | null => {
      const v = ctx[k];
      return typeof v === "number" ? v : null;
    };
    const activos = num("activos");
    const alCorriente = num("al_corriente");
    const requieren = num("requieren_atencion");
    const onboarding = num("onboarding");
    if (activos != null) parts.push(`Clientes activos en cartera: ${activos}`);
    if (alCorriente != null) parts.push(`Al corriente: ${alCorriente}`);
    if (requieren != null) parts.push(`Requieren atención: ${requieren}`);
    if (onboarding != null) parts.push(`Onboarding nuevo este mes: ${onboarding}`);
    if (parts.length === 0) return "";
    return `\nCARTERA DE CLIENTES:\n- ${parts.join("\n- ")}\n(Usa este contexto para elegir una cita sobre relaciones, confianza, servicio o atención al cliente. Si hay clientes en alerta, evita citas eufóricas; si todo está al corriente, refuerza el cuidado.)`;
  }

  const parts: string[] = [];
  if (payload.tasks_pending != null) parts.push(`Tareas pendientes asignadas: ${payload.tasks_pending}`);
  if (payload.completed_today != null) parts.push(`Tareas completadas hoy: ${payload.completed_today}`);
  if (payload.overdue_count != null) parts.push(`Tareas vencidas: ${payload.overdue_count}`);
  if (parts.length === 0) return "";
  return `\nJORNADA ACTUAL:\n- ${parts.join("\n- ")}\n(Usa este contexto para ajustar el TONO de la cita: si hay vencidas u overload, evita eufóricas; si hay logros, celebra; si todo está en cero, motiva con suavidad.)`;
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

    // Las invocaciones desde un cron interno pasan SERVICE_ROLE_KEY como Bearer.
    // En ese caso saltamos getUser() y exigimos `user_id` explícito en el body.
    const bearerToken = authHeader.slice("Bearer ".length).trim();
    const isServiceCall = !!serviceRoleKey && bearerToken === serviceRoleKey;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let userId: string;
    let dbClient: ReturnType<typeof createClient>;

    if (isServiceCall) {
      const explicitUserId = (payload.user_id || "").trim();
      if (!explicitUserId) {
        return new Response(JSON.stringify({ error: "user_id_required_for_service_call" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = explicitUserId;
      dbClient = adminClient;
    } else {
      const requesterClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userErr } = await requesterClient.auth.getUser();
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
      dbClient = requesterClient;
    }
    const moodScore = payload.mood_score ?? null;
    const forceRegenerate = payload.force_regenerate ?? false;
    const timeOfDay = payload.time_of_day === "afternoon" ? "afternoon" : "morning";
    const moduleName: PhraseModule = payload.module === "clientes" ? "clientes" : "tareas";
    const cacheSlot = moduleCacheSlot(timeOfDay, moduleName);
    const phraseDate = resolvePhraseDateForSchedule(new Date());

    if (!forceRegenerate) {
      const { data: existing } = await dbClient
        .from("personalized_phrases")
        .select("phrase, created_at")
        .eq("user_id", userId)
        .eq("phrase_date", phraseDate)
        .eq("time_of_day", cacheSlot)
        .maybeSingle();

      // Si las preferencias del usuario se actualizaron DESPUÉS de generar la frase
      // de hoy, la cache está desfasada (caso típico: completó el cuestionario hoy
      // pero ya se le había generado una frase genérica antes). Forzamos regenerar.
      const { data: prefMeta } = await dbClient
        .from("user_preferences")
        .select("updated_at")
        .eq("user_id", userId)
        .maybeSingle();

      const prefsAreNewer =
        !!prefMeta?.updated_at &&
        !!existing?.created_at &&
        new Date(prefMeta.updated_at).getTime() > new Date(existing.created_at).getTime();

      if (existing?.phrase && !prefsAreNewer) {
        return new Response(
          JSON.stringify({
            cached: true,
            phrase: existing.phrase,
            phrase_date: phraseDate,
            time_of_day: timeOfDay,
            module: moduleName,
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
        .limit(30),
    ]);

    const firstName = profile?.full_name?.split(" ")[0] || "compañero";
    const answers = (prefs?.answers ?? {}) as Record<string, unknown>;
    const hasProfile = Object.keys(answers).length > 0;

    const recentPhraseList = (recentPhrases ?? [])
      .map((entry) => entry.phrase)
      .filter(Boolean);
    const recentPhraseSet = new Set(recentPhraseList.map(normalizePhrase));

    // Cuando ya hay perfil cultural, bloqueamos también las citas demasiado obvias
    // (Einstein de la conciencia, Drucker, Gandhi, etc.) para forzar otra elección.
    const blockedGeneric = hasProfile ? GENERIC_QUOTES_BLOCKLIST : [];
    const blockedSet = new Set([...recentPhraseSet, ...blockedGeneric]);

    const focus = hasProfile ? pickPreferenceFocus(answers, phraseDate, userId) : null;
    const personalContext = hasProfile ? buildPersonalContext(answers) : "";

    const moodContext =
      moodScore != null
        ? `\nÁNIMO ACTUAL: ${moodScore}/5 (${describeMood(moodScore)})`
        : "";

    const journeyContext = buildJourneyContext(payload);

    const blockedQuotes =
      recentPhraseList.length > 0 || blockedGeneric.length > 0
        ? [
            ...recentPhraseList.map((phrase) => phrase.replace(/\s+/g, " ").slice(0, 220)),
            ...blockedGeneric.map((q) => `(genérica) ${q}`),
          ]
            .map((line, idx) => `${idx + 1}. ${line}`)
            .join("\n")
        : "Sin citas previas recientes.";

    const focusInstruction = focus
      ? `\nPREFERENCIA FOCAL DE HOY: "${focus.value}" (campo: ${focus.key}).
La cita DEBE estar conectada de forma evidente con esta preferencia: provenir de esa persona/obra/banda, ser un personaje de ese universo, o tratar el tema central que esa preferencia representa para ${firstName}.`
      : "";

    const moduleInstruction =
      moduleName === "clientes"
        ? `\n\nMÓDULO PRIORITARIO (manda sobre cualquier otra preferencia): Clientes / cartera.
La cita DEBE girar en torno a UNO de estos ejes: relaciones humanas, confianza, atención al cliente, servicio, escucha activa, reputación, fidelidad, vínculo a largo plazo. Evita citas de:
- productividad personal o gestión del tiempo
- política, lucha de clases, sociología macro
- guerra, conflicto o competencia
Si la PREFERENCIA FOCAL del usuario no encaja con esos ejes para el módulo Clientes, IGNÓRALA y elige otra cita auténtica del eje del módulo.`
        : "";

    // Ajuste de tono según preferencias v2 del usuario
    const tonoS = parseInt(answerStr((answers as Record<string, unknown>).tono_serio_divertido) || "3", 10);
    const tonoL = parseInt(answerStr((answers as Record<string, unknown>).tono_corto_largo) || "3", 10);
    const toneHint = hasProfile && ("tono_serio_divertido" in answers)
      ? `\nTONO SOLICITADO: ${tonoS <= 2 ? "serio y formal" : tonoS >= 4 ? "ligero y cercano, puede tener humor" : "equilibrado"}. Extensión de la CITA: ${tonoL <= 2 ? "muy breve (máx 1 línea)" : tonoL >= 4 ? "puede ser una cita un poco más larga, máx 3 líneas" : "normal (1-2 líneas)"}. NO añadas párrafos de reflexión ni contexto extra fuera del formato.`
      : "";

    const basePrompt = `Selecciona UNA frase o cita REAL y EXISTENTE para ${firstName}.
Momento del día: ${timeOfDay === "afternoon" ? "tarde" : "mañana"}.
Fecha objetivo de frase (CDMX): ${phraseDate}.${moodContext}${journeyContext}
${personalContext}${toneHint}${focusInstruction}${moduleInstruction}

INSTRUCCIONES:
1. La frase DEBE SER una cita real, verificable, de un personaje, autor, músico, película, serie, libro o figura pública.
2. ${
      hasProfile
        ? "OBLIGATORIO: ancla la cita en la PREFERENCIA FOCAL DE HOY indicada arriba. Si no encuentras una cita auténtica de esa fuente, usa otra preferencia del PERFIL CULTURAL, NUNCA una cita genérica de motivación universal."
        : "Elige una cita célebre motivacional de alguna figura reconocida."
    }
3. Ajusta la extensión al tono solicitado (si se especificó).
4. Incluye atribución completa: quién lo dijo y de dónde viene (obra, álbum, película, entrevista).
5. Si no puedes verificar que la cita es real y está bien atribuida, crea una reflexión original en el estilo del perfil y usa "— Reflexión para hoy" como atribución (Confianza: original).
6. Ajusta el TONO al ánimo y la jornada actual (no celebres si hay overload, no exijas si el ánimo es bajo).
7. Evita repetir textualmente cualquiera de estas citas (recientes o genéricas vetadas):
${blockedQuotes}
8. Formato EXACTO. SOLO estas líneas, sin nada más — sin párrafos adicionales, sin separadores, sin markdown:
FRASE: [la cita textual, sin asteriscos ni formato]
— [Autor/Personaje], [Fuente/Obra, sin asteriscos]
Confianza: [alta | media | original]
Conecta con: [campo del perfil, o "general"]`;

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
    let confidence: "alta" | "media" | "original" = "media";
    let generated = false;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const attemptPrompt =
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANTE: En tu intento anterior elegiste una cita repetida o demasiado genérica. Elige otra distinta y, si hay PREFERENCIA FOCAL, ánclala ahí.`;

        const rawPhrase = await requestAiPhrase(attemptPrompt);
        const parsed = parsePhrase(rawPhrase);
        const normalized = normalizePhrase(parsed.text);

        const isBlockedGeneric = blockedGeneric.some((g) => normalized.includes(g));
        if (!blockedSet.has(normalized) && !isBlockedGeneric) {
          phrase = parsed.text;
          confidence = parsed.confidence;
          generated = true;
          break;
        }

        phrase = parsed.text;
        confidence = parsed.confidence;
      }
    } catch (phraseLoopErr) {
      const msg = phraseLoopErr instanceof Error ? phraseLoopErr.message : "";
      const overload =
        msg.startsWith("AI_PROVIDER_ERROR|") &&
        /overload/i.test(msg.slice("AI_PROVIDER_ERROR|".length));
      if (overload) {
        const nonRepeatedFallback = FALLBACK_QUOTES.find(
          (candidate) => !blockedSet.has(normalizePhrase(candidate))
        );
        phrase = nonRepeatedFallback ?? FALLBACK_QUOTES[0] ?? phrase;
        confidence = "alta";
        generated = true;
      } else {
        throw phraseLoopErr;
      }
    }

    if (!generated) {
      const nonRepeatedFallback = FALLBACK_QUOTES.find(
        (candidate) => !blockedSet.has(normalizePhrase(candidate))
      );
      phrase = nonRepeatedFallback ?? phrase;
      confidence = "alta";
    }

    // organization_id es NOT NULL en la tabla; si el perfil no lo tiene aún, buscamos
    // el org del usuario directamente para no fallar silenciosamente al cachear la frase.
    let orgId: string | null = profile?.organization_id ?? null;
    if (!orgId) {
      const { data: orgRow } = await adminClient
        .from("profiles")
        .select("organization_id")
        .eq("user_id", userId)
        .maybeSingle();
      orgId = orgRow?.organization_id ?? null;
    }

    if (orgId) {
      await adminClient.from("personalized_phrases").upsert(
        {
          user_id: userId,
          organization_id: orgId,
          phrase,
          phrase_date: phraseDate,
          time_of_day: cacheSlot,
          mood_score: moodScore,
          verification_confidence: confidence,
        },
        { onConflict: "user_id,phrase_date,time_of_day" }
      );
    } else {
      console.warn("generate-phrase: skipping cache for user", userId, "— missing organization_id");
    }

    return new Response(
      JSON.stringify({
        cached: false,
        phrase,
        phrase_date: phraseDate,
        time_of_day: timeOfDay,
        module: moduleName,
        confidence,
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
