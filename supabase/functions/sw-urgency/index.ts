// sw-urgency — decide si la llamada es urgente combinando reglas por keywords
// (deterministas) + Claude Haiku (señales implícitas). Devuelve urgente=true si
// se cumple AL MENOS uno de los 4 criterios, e indica cuáles se activaron.
//
// Criterios:
//   (1) audiencia_48h          audiencia/diligencia/comparecencia en <48h
//   (2) persona_detenida       persona detenida/arrestada/bajo custodia
//   (3) requerimiento_autoridad citatorio/oficio/notificación SAT/IMSS/juez/MP
//   (4) lenguaje_urgencia      "urgente/emergencia/inmediato/hoy/ahora/…"
import { corsHeaders, jsonResponse, checkWebhookAuth } from "../_shared/switchboard-http.ts";
import { callAnthropicText, MODEL_HAIKU } from "../_shared/anthropic.ts";
import { detectUrgencyCriteria, type CriterioUrgencia } from "../_shared/conmutador.ts";

const CRITERIOS: CriterioUrgencia[] = [
  "audiencia_48h",
  "persona_detenida",
  "requerimiento_autoridad",
  "lenguaje_urgencia",
];

const URGENCY_SYSTEM =
  "Analizas la transcripción de una llamada a un despacho legal-contable mexicano " +
  "para detectar URGENCIA por señales implícitas. Responde SOLO con JSON válido: " +
  '{"audiencia_48h":bool,"persona_detenida":bool,"requerimiento_autoridad":bool,' +
  '"lenguaje_urgencia":bool}. ' +
  "audiencia_48h: hay audiencia/diligencia/comparecencia dentro de ~48h. " +
  "persona_detenida: alguien está detenido/arrestado/bajo custodia. " +
  "requerimiento_autoridad: hay citatorio/oficio/notificación/requerimiento de una " +
  "autoridad (SAT/IMSS/juez/MP/fiscalía). " +
  "lenguaje_urgencia: el llamante transmite urgencia/emergencia/inmediatez. " +
  "Marca true solo con evidencia razonable.";

function parseUrgencyLLM(raw: string): Set<CriterioUrgencia> {
  const set = new Set<CriterioUrgencia>();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return set;
  try {
    const obj = JSON.parse(m[0]);
    for (const c of CRITERIOS) if (obj[c] === true) set.add(c);
  } catch {
    /* ignora parseo inválido */
  }
  return set;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauth = checkWebhookAuth(req);
  if (unauth) return unauth;

  try {
    const { transcript } = await req.json().catch(() => ({ transcript: "" }));
    if (typeof transcript !== "string") {
      return jsonResponse({ error: "transcript requerido" }, 400);
    }

    // (1) Reglas por keywords — siempre disponibles, sin latencia de red.
    const byKeyword = new Set<CriterioUrgencia>(detectUrgencyCriteria(transcript));

    // (2) Haiku para señales implícitas (best-effort; si falla, usamos keywords).
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    let byLLM = new Set<CriterioUrgencia>();
    if (apiKey && transcript.trim().length > 0) {
      try {
        const raw = await callAnthropicText({
          apiKey,
          model: MODEL_HAIKU,
          system: URGENCY_SYSTEM,
          messages: [{ role: "user", content: `Transcripción:\n"""${transcript}"""` }],
          max_tokens: 120,
        });
        byLLM = parseUrgencyLLM(raw);
      } catch (e) {
        console.warn("sw-urgency Haiku falló, uso solo keywords:", String(e));
      }
    }

    const criterios = CRITERIOS.filter((c) => byKeyword.has(c) || byLLM.has(c));
    const urgente = criterios.length > 0;

    return jsonResponse({
      urgente,
      criterios,
      fuente: {
        keywords: [...byKeyword],
        modelo: [...byLLM],
      },
    });
  } catch (e) {
    console.error("sw-urgency error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
