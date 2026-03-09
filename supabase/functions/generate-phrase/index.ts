import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } =
      await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims)
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const userId = claimsData.claims.sub as string;
    const { mood_score, time_of_day, force_regenerate } = await req.json();

    // Check if we already have a phrase for this user/date/time
    const todayStr = new Date().toISOString().split("T")[0];
    if (!force_regenerate) {
      const { data: existing } = await supabase
        .from("personalized_phrases")
        .select("phrase")
        .eq("user_id", userId)
        .eq("phrase_date", todayStr)
        .eq("time_of_day", time_of_day || "morning")
        .maybeSingle();

      if (existing?.phrase) {
        return new Response(
          JSON.stringify({ phrase: existing.phrase, cached: true }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Fetch user preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("answers")
      .eq("user_id", userId)
      .maybeSingle();

    // Fetch user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, area")
      .eq("user_id", userId)
      .single();

    const firstName = profile?.full_name?.split(" ")[0] || "compañero";
    const answers = prefs?.answers || {};

    // Build personalization context from preferences
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

Usa estas preferencias para personalizar la frase con referencias sutiles a sus gustos. 
Por ejemplo, si le gusta Star Wars, podrías hacer una referencia a "la fuerza", si le gusta la música clásica podrías usar una metáfora musical.`;
    }

    const moodContext =
      mood_score != null
        ? `\nÁNIMO ACTUAL: ${mood_score}/5 (${mood_score <= 2 ? "bajo — necesita apoyo y empatía" : mood_score <= 3 ? "neutral — motivar suavemente" : "alto — reforzar energía positiva"})`
        : "";

    const prompt = `Selecciona UNA frase o cita REAL y EXISTENTE que motive a ${firstName}, basándote en sus gustos culturales.
Momento del día: ${time_of_day === "afternoon" ? "tarde" : "mañana"}.
${moodContext}
${personalContext}

INSTRUCCIONES:
1. La frase DEBE SER una cita real de un personaje, autor, músico, película, serie, libro o figura pública que conecte con los gustos del usuario.
2. ${Object.keys(answers).length > 0 ? "Elige citas de autores, personajes o figuras relacionadas con sus gustos (ej: si le gusta Star Wars, una cita de Yoda; si le gusta el rock, una de algún músico de rock; si le gusta la ciencia ficción, de un autor de sci-fi)." : "Elige una cita célebre motivacional de alguna figura reconocida."}
3. Máximo 2 líneas la cita.
4. Incluye la atribución: quién lo dijo y de dónde viene (libro, película, canción, etc.)
5. NO inventes frases. Solo citas reales verificables.
6. Formato de respuesta EXACTO (sin comillas extras):
FRASE: [la cita textual]
— [Autor/Personaje], [Fuente/Obra]`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY)
      throw new Error("LOVABLE_API_KEY is not configured");

    const aiResp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "Eres un curador cultural experto. Tu trabajo es encontrar citas REALES y verificables de libros, películas, series, canciones, filósofos, deportistas y figuras públicas que conecten con los gustos específicos de cada persona. Solo compartes citas auténticas, nunca inventas. Responde en el formato solicitado.",
            },
            { role: "user", content: prompt },
          ],
        }),
      }
    );

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Demasiadas solicitudes. Intenta en unos minutos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos de IA agotados." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      throw new Error("AI gateway error");
    }

    const aiData = await aiResp.json();
    const phrase =
      aiData.choices?.[0]?.message?.content?.trim() ||
      "Cada día trae consigo la oportunidad de hacer algo extraordinario.";

    // Save to cache using service role to bypass RLS for upsert
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get org id
    const { data: orgData } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .single();

    await adminClient.from("personalized_phrases").upsert(
      {
        user_id: userId,
        organization_id: orgData?.organization_id,
        phrase,
        phrase_date: todayStr,
        time_of_day: time_of_day || "morning",
        mood_score: mood_score ?? null,
      },
      { onConflict: "user_id,phrase_date,time_of_day" }
    );

    return new Response(JSON.stringify({ phrase, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-phrase error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
