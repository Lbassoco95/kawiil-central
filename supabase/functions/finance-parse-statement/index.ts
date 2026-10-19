/**
 * Desglose de movimientos financieros con Claude.
 *
 * Dos modos:
 *  - mode = "statement": procesa un estado de cuenta cargado (PDF, Excel/CSV o
 *    imagen), extrae la lista de movimientos y los guarda en bank_movements
 *    ligados al bank_statements.id recibido.
 *  - mode = "receipt": lee un ticket/comprobante (imagen o PDF) y devuelve UN
 *    gasto sugerido (monto, fecha, concepto, categoría) para precargar el
 *    formulario de nueva solicitud. No escribe en base de datos.
 *
 * Requiere JWT válido + has_finance_access. Secret: ANTHROPIC_API_KEY.
 * Primer paso hacia open banking: por ahora la carga es manual.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const STORAGE_BUCKET = "documents";

function modelId(): string {
  return (Deno.env.get("FINANCE_STATEMENT_MODEL") || "").trim() || "claude-3-5-sonnet-20241022";
}

const VALID_CATEGORIES = ["terceros", "viaticos", "operativo", "contratacion_externa", "otro"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Convierte un ArrayBuffer a base64 en bloques (evita desbordar el stack). */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function extFromName(name: string | null | undefined): string {
  if (!name) return "";
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** Extrae el primer bloque JSON válido de la respuesta del modelo. */
function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const STATEMENT_INSTRUCTIONS = `Eres un asistente contable del despacho Kawiil. Recibes un estado de cuenta bancario (o una exportación de movimientos). Extrae TODOS los movimientos, uno por renglón.

Devuelve SOLO un objeto JSON válido, sin texto adicional, con esta forma exacta:
{
  "bank_name": "string o null",
  "account_label": "últimos dígitos o alias de la cuenta, o null",
  "period_start": "YYYY-MM-DD o null",
  "period_end": "YYYY-MM-DD o null",
  "summary": "resumen en 1-2 frases (total cargos, total abonos, # movimientos)",
  "movements": [
    {
      "date": "YYYY-MM-DD",
      "description": "concepto tal cual aparece",
      "amount": 1234.56,
      "direction": "cargo" | "abono",
      "balance": 0 o null,
      "counterparty": "a quién se pagó o de quién se recibió, o null",
      "suggested_category": "terceros" | "viaticos" | "operativo" | "contratacion_externa" | "otro"
    }
  ]
}

Reglas:
- "cargo" = egreso/retiro/pago (sale dinero). "abono" = depósito/ingreso (entra dinero).
- amount SIEMPRE positivo, la dirección indica el signo.
- Categorías: "terceros" gasto por cuenta de un cliente; "viaticos" viajes/transporte/comidas; "operativo" gastos internos (renta, software, servicios, nómina, papelería); "contratacion_externa" pago a proveedor/profesional externo; "otro" si no encaja o es un abono.
- No inventes movimientos. Si un renglón es ilegible, omítelo.`;

const RECEIPT_INSTRUCTIONS = `Eres un asistente contable del despacho Kawiil. Recibes la foto o PDF de un ticket/comprobante/factura de UN gasto. Extrae los datos del gasto.

Devuelve SOLO un objeto JSON válido, sin texto adicional, con esta forma exacta:
{
  "amount": 1234.56,
  "currency": "MXN" | "USD" | "EUR",
  "date": "YYYY-MM-DD o null",
  "vendor": "nombre del comercio/proveedor o null",
  "description": "concepto breve del gasto (máx 120 caracteres)",
  "suggested_category": "terceros" | "viaticos" | "operativo" | "contratacion_externa"
}

Reglas:
- amount = total pagado (con impuestos), positivo.
- Categorías: "terceros" gasto por cuenta de un cliente; "viaticos" viajes/transporte/comidas fuera de oficina; "operativo" gastos internos (papelería, software, servicios); "contratacion_externa" pago a proveedor/profesional externo.
- Si no puedes leer el monto, devuelve amount: null.`;

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

async function callAnthropic(
  apiKey: string,
  system: string,
  blocks: AnthropicBlock[],
  isPdf: boolean,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (isPdf) headers["anthropic-beta"] = "pdfs-2024-09-25";

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelId(),
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: blocks }],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
      throw new Error(`anthropic_billing:${detail.slice(0, 300)}`);
    }
    if (resp.status === 429 || resp.status === 529) {
      throw new Error(`claude_overloaded:${detail.slice(0, 200)}`);
    }
    throw new Error(`anthropic_${resp.status}:${detail.slice(0, 300)}`);
  }

  const data = await resp.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  return parts
    .filter((p: { type?: string }) => p?.type === "text")
    .map((p: { text?: string }) => p.text || "")
    .join("\n")
    .trim();
}

/** Construye los bloques de contenido según el tipo de archivo. */
function buildBlocks(
  bytes: ArrayBuffer,
  ext: string,
  contentType: string,
  instructions: string,
): { blocks: AnthropicBlock[]; isPdf: boolean } {
  const isPdf = ext === "pdf" || contentType.includes("pdf");
  const isImage =
    ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || contentType.startsWith("image/");
  const isCsv = ext === "csv" || contentType.includes("csv");
  const isXlsx = ["xlsx", "xls"].includes(ext) || contentType.includes("sheet") || contentType.includes("excel");

  if (isPdf) {
    return {
      isPdf: true,
      blocks: [
        { type: "text", text: instructions },
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) },
        },
      ],
    };
  }

  if (isImage) {
    const mt = contentType.startsWith("image/")
      ? contentType
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";
    return {
      isPdf: false,
      blocks: [
        { type: "text", text: instructions },
        { type: "image", source: { type: "base64", media_type: mt, data: toBase64(bytes) } },
      ],
    };
  }

  // Excel/CSV → texto tabular
  let tableText = "";
  if (isXlsx) {
    const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
    for (const sheetName of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
      tableText += `# Hoja: ${sheetName}\n${csv}\n\n`;
    }
  } else if (isCsv) {
    tableText = new TextDecoder("utf-8").decode(bytes);
  } else {
    // Último recurso: intentar como texto plano.
    tableText = new TextDecoder("utf-8").decode(bytes);
  }
  tableText = tableText.slice(0, 60_000);
  return {
    isPdf: false,
    blocks: [{ type: "text", text: `${instructions}\n\nDatos (formato tabla):\n${tableText}` }],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "IA no configurada (falta ANTHROPIC_API_KEY)." }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: financeOk } = await admin.rpc("has_finance_access", { _user_id: user.id });
    if (!financeOk) return json({ error: "Forbidden: se requiere acceso a Finanzas." }, 403);

    const body = (await req.json().catch(() => ({}))) as {
      mode?: string;
      path?: string;
      source_type?: string;
      statement_id?: string;
    };
    const mode = body.mode === "receipt" ? "receipt" : "statement";
    const path = (body.path || "").trim();
    if (!path) return json({ error: "Falta 'path' del archivo a procesar." }, 400);

    // Descarga el archivo del bucket.
    const { data: fileData, error: dlErr } = await admin.storage.from(STORAGE_BUCKET).download(path);
    if (dlErr || !fileData) return json({ error: `No se pudo leer el archivo: ${dlErr?.message}` }, 400);
    const bytes = await fileData.arrayBuffer();
    const contentType = fileData.type || "";
    const ext = extFromName(path) || extFromName(body.source_type);

    const instructions = mode === "receipt" ? RECEIPT_INSTRUCTIONS : STATEMENT_INSTRUCTIONS;
    const { blocks, isPdf } = buildBlocks(bytes, ext, contentType, instructions);

    let content = "";
    try {
      content = await callAnthropic(ANTHROPIC_API_KEY, instructions, blocks, isPdf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mode === "statement" && body.statement_id) {
        await admin
          .from("bank_statements")
          .update({ status: "error", error_message: msg.slice(0, 500) })
          .eq("id", body.statement_id);
      }
      if (msg.startsWith("anthropic_billing")) return json({ error: "Créditos de IA insuficientes.", code: "anthropic_billing" }, 402);
      if (msg.startsWith("claude_overloaded")) return json({ error: "Claude está saturado, intenta de nuevo.", code: "claude_overloaded" }, 503);
      return json({ error: msg }, 502);
    }

    const parsed = parseJsonLoose(content);
    if (!parsed) return json({ error: "La IA no devolvió un JSON válido." }, 502);

    // ── Modo comprobante: devuelve un solo gasto sugerido ─────────────────────
    if (mode === "receipt") {
      const cat = String(parsed.suggested_category || "");
      return json({
        ok: true,
        receipt: {
          amount: typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount) || null,
          currency: ["MXN", "USD", "EUR"].includes(String(parsed.currency)) ? parsed.currency : "MXN",
          date: typeof parsed.date === "string" ? parsed.date : null,
          vendor: typeof parsed.vendor === "string" ? parsed.vendor : null,
          description: typeof parsed.description === "string" ? parsed.description.slice(0, 200) : "",
          suggested_category: VALID_CATEGORIES.includes(cat) ? cat : "operativo",
        },
      });
    }

    // ── Modo estado de cuenta: guarda los movimientos ─────────────────────────
    const statementId = (body.statement_id || "").trim();
    if (!statementId) return json({ error: "Falta 'statement_id' para el modo estado de cuenta." }, 400);

    const { data: statement, error: stErr } = await admin
      .from("bank_statements")
      .select("id, organization_id")
      .eq("id", statementId)
      .single();
    if (stErr || !statement) return json({ error: "Estado de cuenta no encontrado." }, 404);
    const orgId = (statement as { organization_id: string }).organization_id;

    const rawMovements = Array.isArray(parsed.movements) ? parsed.movements : [];
    const rows = rawMovements
      .map((m: Record<string, unknown>) => {
        const amount = typeof m.amount === "number" ? Math.abs(m.amount) : Math.abs(Number(m.amount) || 0);
        if (!amount) return null;
        const direction = m.direction === "abono" ? "abono" : "cargo";
        const cat = String(m.suggested_category || "");
        return {
          organization_id: orgId,
          statement_id: statementId,
          movement_date: typeof m.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : null,
          description: typeof m.description === "string" ? m.description.slice(0, 500) : null,
          amount,
          direction,
          currency: "MXN",
          balance: typeof m.balance === "number" ? m.balance : null,
          counterparty: typeof m.counterparty === "string" ? m.counterparty.slice(0, 200) : null,
          suggested_category: VALID_CATEGORIES.includes(cat) ? cat : null,
          status: "pendiente",
          created_by: user.id,
          raw: m,
        };
      })
      .filter(Boolean);

    if (rows.length > 0) {
      const { error: insErr } = await admin.from("bank_movements").insert(rows as unknown[]);
      if (insErr) {
        await admin
          .from("bank_statements")
          .update({ status: "error", error_message: insErr.message.slice(0, 500) })
          .eq("id", statementId);
        return json({ error: `No se pudieron guardar los movimientos: ${insErr.message}` }, 500);
      }
    }

    await admin
      .from("bank_statements")
      .update({
        status: "listo",
        movements_count: rows.length,
        ai_summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : null,
        bank_name: typeof parsed.bank_name === "string" ? parsed.bank_name.slice(0, 120) : null,
        account_label: typeof parsed.account_label === "string" ? parsed.account_label.slice(0, 120) : null,
        period_start:
          typeof parsed.period_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.period_start)
            ? parsed.period_start
            : null,
        period_end:
          typeof parsed.period_end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.period_end)
            ? parsed.period_end
            : null,
        error_message: null,
      })
      .eq("id", statementId);

    return json({ ok: true, movements_count: rows.length, summary: parsed.summary || null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Error desconocido" }, 500);
  }
});
