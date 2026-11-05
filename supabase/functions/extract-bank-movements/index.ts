// Lee una o varias capturas de pantalla de movimientos bancarios (app del banco) con visión de Claude
// y devuelve los movimientos estructurados para revisarlos antes de cargarlos en Finanzas.
//
// NO escribe en la base: el usuario revisa y confirma en pantalla.
// Solo para quien tiene acceso a la gestión de Finanzas (public.has_finance_access).
//
// Secret requerido: ANTHROPIC_API_KEY
//
// Contrato:
//   POST { images: [{ base64, media_type }], default_year?: number }
//   200  { ok: true, movements: [{ date, description, debit, credit, balance, uncertain }], notes }
//   4xx  { error }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_IMAGES = 4;
const MAX_BASE64_CHARS = 7_000_000; // ~5 MB por imagen (límite de la API)
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function anthropicErrorMessage(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
  if (status === 401) return "La ANTHROPIC_API_KEY es inválida o falta en Edge Functions (Secrets).";
  if (status === 404) return `El modelo ${MODEL} no está disponible para esta API key.`;
  if (status === 429) return "Límite de uso de la IA alcanzado; espera un momento y reintenta.";
  if (status === 529 || status === 503) return "El servicio de IA está saturado; reintenta en un momento.";
  return `La IA no pudo leer la captura (Anthropic ${status}). ${snippet}`;
}

const tool = {
  name: "save_movements",
  description: "Guarda los movimientos bancarios leídos de la(s) captura(s).",
  input_schema: {
    type: "object",
    properties: {
      movements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: ["string", "null"], description: "Fecha ISO YYYY-MM-DD. Si la captura no trae año, usa el año indicado." },
            description: { type: "string", description: "Descripción/concepto tal como aparece, sin inventar." },
            debit: { type: "number", description: "Monto que SALE (cargo, retiro, compra, pago, transferencia enviada). 0 si no aplica. Siempre positivo." },
            credit: { type: "number", description: "Monto que ENTRA (abono, depósito, devolución, transferencia recibida). 0 si no aplica. Siempre positivo." },
            balance: { type: ["number", "null"], description: "Saldo después del movimiento, solo si la captura lo muestra." },
            uncertain: { type: "boolean", description: "true si algún dato (fecha, monto o signo) no se leyó con claridad." },
          },
          required: ["date", "description", "debit", "credit", "uncertain"],
        },
      },
      notes: { type: ["string", "null"], description: "Observaciones breves: ej. captura cortada, año asumido, importes ilegibles." },
    },
    required: ["movements"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "IA no configurada (falta ANTHROPIC_API_KEY)." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);
    const callerClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) return json({ error: "No autorizado" }, 401);

    // Solo quien gestiona Finanzas (misma regla que las tablas finance_*).
    const { data: allowed, error: accessError } = await callerClient.rpc("has_finance_access", { _user_id: user.id });
    if (accessError || allowed !== true) return json({ error: "No tienes acceso a la gestión de Finanzas." }, 403);

    const body = await req.json().catch(() => ({}));
    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length === 0) return json({ error: "Falta al menos una imagen." }, 400);
    if (images.length > MAX_IMAGES) return json({ error: `Máximo ${MAX_IMAGES} capturas por vez.` }, 400);
    const year = Number.isInteger(body.default_year) && body.default_year > 2000 && body.default_year < 2100 ? body.default_year : new Date().getFullYear();

    const content: unknown[] = [];
    for (const im of images) {
      const mime = String(im?.media_type ?? "");
      const b64 = String(im?.base64 ?? "");
      if (!ALLOWED.has(mime)) return json({ error: "Formato de imagen no permitido (usa PNG, JPG o WEBP)." }, 400);
      if (!b64 || b64.length > MAX_BASE64_CHARS) return json({ error: "Una imagen está vacía o pesa demasiado." }, 400);
      content.push({ type: "image", source: { type: "base64", media_type: mime, data: b64 } });
    }
    content.push({
      type: "text",
      text: `Lee los movimientos de ${images.length === 1 ? "esta captura" : "estas capturas"} y guárdalos con la herramienta save_movements.`,
    });

    const system = `Eres un asistente que transcribe movimientos bancarios de capturas de pantalla (apps o banca en línea de bancos mexicanos) a datos estructurados.

Reglas:
- Transcribe SOLO lo que se ve. No inventes movimientos, montos ni fechas. Si algo no se lee con claridad, márcalo uncertain=true.
- Un movimiento por renglón de la lista. Si hay varias capturas que se traslapan (mismo movimiento visible en dos), inclúyelo una sola vez.
- Dinero que sale (compra, pago, retiro, cargo, comisión, transferencia enviada, importe con signo menos) va en debit; dinero que entra (depósito, abono, devolución, transferencia recibida) va en credit. Ambos números siempre positivos; el que no aplica es 0.
- Montos en pesos mexicanos con punto decimal (quita el $, comas de miles y el signo).
- Fechas en formato ISO YYYY-MM-DD. Si la captura muestra día y mes sin año (ej. "4 nov"), usa el año ${year}. Si muestra encabezados de fecha agrupados ("Hoy", "Ayer", "4 de noviembre"), aplícalos a los movimientos de debajo; si no puedes resolver la fecha, date=null y uncertain=true.
- Ignora saldos de cuenta, anuncios, botones y totales que no sean un movimiento.
- Conserva el orden en que aparecen.
- Responde SIEMPRE usando la herramienta save_movements.`;

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 6000, system, messages: [{ role: "user", content }],
        tools: [tool], tool_choice: { type: "tool", name: "save_movements" },
      }),
    });
    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, errText.substring(0, 500));
      return json({ error: anthropicErrorMessage(aiResp.status, errText) }, 502);
    }
    const aiJson = await aiResp.json();
    const toolUse = (aiJson.content as Array<{ type: string; name?: string; input?: unknown }>)?.find(
      (b) => b.type === "tool_use" && b.name === "save_movements",
    );
    if (!toolUse?.input) return json({ error: "El modelo no devolvió movimientos estructurados." }, 502);

    const r = toolUse.input as { movements?: unknown[]; notes?: unknown };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : 0);
    const movements = (Array.isArray(r.movements) ? r.movements : []).map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
      return {
        date,
        description: typeof o.description === "string" ? o.description.replace(/\s+/g, " ").trim().slice(0, 240) : "",
        debit: num(o.debit),
        credit: num(o.credit),
        balance: typeof o.balance === "number" && Number.isFinite(o.balance) ? o.balance : null,
        uncertain: o.uncertain === true || date === null,
      };
    }).filter((m) => m.description && (m.debit > 0 || m.credit > 0));

    return json({ ok: true, movements, notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim() : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("extract-bank-movements error:", message);
    return json({ error: message }, 500);
  }
});
