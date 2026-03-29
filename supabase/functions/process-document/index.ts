import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

let _cachedDropboxToken: string | null = null;
let _cachedDropboxExpiry = 0;
let _dbxAdminId: string | null = null;
let _dbxRootNs: string | null = null;

async function getDropboxAccessToken(): Promise<string | null> {
  if (_cachedDropboxToken && Date.now() < _cachedDropboxExpiry - 60_000) {
    return _cachedDropboxToken;
  }

  let refreshToken = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  const appKey = Deno.env.get("DROPBOX_APP_KEY");
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET");

  if (!refreshToken || refreshToken.length < 50) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey);
      const { data } = await sb.from("integrations").select("config").eq("provider", "dropbox").eq("is_active", true).single();
      if (data?.config?.refresh_token) refreshToken = data.config.refresh_token;
    }
  }

  if (refreshToken && appKey && appSecret && refreshToken.length > 50) {
    const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (resp.ok) {
      const data = await resp.json();
      _cachedDropboxToken = data.access_token;
      _cachedDropboxExpiry = Date.now() + data.expires_in * 1000;
      return _cachedDropboxToken;
    }
  }

  const staticToken = Deno.env.get("DROPBOX_ACCESS_TOKEN");
  return staticToken || null;
}

async function initDropboxTeam(token: string): Promise<void> {
  if (_dbxAdminId && _dbxRootNs) return;
  try {
    const mr = await fetch("https://api.dropboxapi.com/2/team/members/list_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    });
    if (mr.ok) {
      const d = await mr.json();
      const admin = (d?.members || []).find((m: any) => m?.role?.[".tag"] === "team_admin");
      _dbxAdminId = admin?.profile?.team_member_id || (d?.members?.[0]?.profile?.team_member_id) || null;
    }
  } catch {}
  try {
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (_dbxAdminId) h["Dropbox-API-Select-Admin"] = _dbxAdminId;
    const ar = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: h });
    if (ar.ok) { _dbxRootNs = (await ar.json())?.root_info?.root_namespace_id || null; }
  } catch {}
}

function dropboxDownloadHeaders(token: string, path: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Dropbox-API-Arg": JSON.stringify({ path }),
  };
  if (_dbxAdminId) h["Dropbox-API-Select-Admin"] = _dbxAdminId;
  if (_dbxRootNs) h["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: _dbxRootNs });
  return h;
}

// Tool definitions for structured extraction
const extractionTools = [
  {
    name: "save_cfdi_data",
    description: "Guarda los datos extraídos de una factura CFDI (XML o PDF). Usa esta herramienta cuando el documento sea una factura electrónica mexicana.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: { type: "string" as const, enum: ["cfdi"], description: "Tipo de documento" },
        cfdi_type: { type: "string" as const, enum: ["ingreso", "egreso", "traslado", "pago", "nomina"], description: "Tipo de CFDI" },
        uuid_fiscal: { type: "string" as const, description: "UUID del timbre fiscal (folio fiscal)" },
        rfc_emisor: { type: "string" as const, description: "RFC del emisor" },
        rfc_receptor: { type: "string" as const, description: "RFC del receptor" },
        nombre_emisor: { type: "string" as const, description: "Nombre o razón social del emisor" },
        nombre_receptor: { type: "string" as const, description: "Nombre o razón social del receptor" },
        document_date: { type: "string" as const, description: "Fecha del comprobante YYYY-MM-DD" },
        fiscal_period: { type: "string" as const, description: "Periodo fiscal YYYY-MM" },
        subtotal: { type: "number" as const, description: "Subtotal antes de impuestos" },
        total_amount: { type: "number" as const, description: "Total del comprobante" },
        tax_amount: { type: "number" as const, description: "Total de impuestos trasladados" },
        iva_amount: { type: "number" as const, description: "Monto de IVA" },
        isr_retenido: { type: "number" as const, description: "ISR retenido si aplica" },
        iva_retenido: { type: "number" as const, description: "IVA retenido si aplica" },
        currency: { type: "string" as const, description: "Moneda (MXN, USD, etc.)" },
        uso_cfdi: { type: "string" as const, description: "Uso del CFDI" },
        regimen_fiscal_emisor: { type: "string" as const, description: "Régimen fiscal del emisor" },
        metodo_pago: { type: "string" as const, description: "Método de pago (PUE, PPD)" },
        forma_pago: { type: "string" as const, description: "Forma de pago (01, 02, etc.)" },
        conceptos: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              descripcion: { type: "string" as const },
              cantidad: { type: "number" as const },
              valor_unitario: { type: "number" as const },
              importe: { type: "number" as const },
              clave_prod_serv: { type: "string" as const },
            },
          },
          description: "Lista de conceptos del CFDI",
        },
        ai_summary: { type: "string" as const, description: "Resumen ejecutivo de la factura" },
        observations: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Observaciones, alertas o anomalías detectadas",
        },
        confidence_score: { type: "number" as const, description: "Confianza de la extracción de 0.0 a 1.0" },
      },
      required: ["document_type", "rfc_emisor", "total_amount", "document_date", "confidence_score"],
    },
  },
  {
    name: "save_declaration_data",
    description: "Guarda datos extraídos de una declaración fiscal (mensual, anual, informativa). Usa esta herramienta para cualquier declaración presentada ante el SAT.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: { type: "string" as const, enum: ["declaracion_mensual", "declaracion_anual", "declaracion_informativa"] },
        declaration_type: { type: "string" as const, enum: ["provisional", "definitiva", "anual", "informativa", "complementaria"] },
        rfc_emisor: { type: "string" as const, description: "RFC del contribuyente" },
        nombre_contribuyente: { type: "string" as const },
        document_date: { type: "string" as const, description: "Fecha de presentación YYYY-MM-DD" },
        fiscal_period: { type: "string" as const, description: "Periodo fiscal (YYYY-MM para mensual, YYYY para anual)" },
        regimen_fiscal: { type: "string" as const },
        // ISR
        isr_a_cargo: { type: "number" as const },
        isr_a_favor: { type: "number" as const },
        isr_retenido: { type: "number" as const },
        ingresos_acumulables: { type: "number" as const },
        deducciones_autorizadas: { type: "number" as const },
        resultado_fiscal: { type: "number" as const },
        coeficiente_utilidad: { type: "number" as const },
        // IVA
        iva_a_cargo: { type: "number" as const },
        iva_a_favor: { type: "number" as const },
        iva_acreditable: { type: "number" as const },
        iva_trasladado: { type: "number" as const },
        iva_retenido: { type: "number" as const },
        // Totales
        total_amount: { type: "number" as const, description: "Monto total a pagar o a favor" },
        tax_amount: { type: "number" as const, description: "Total de impuestos determinados" },
        isr_amount: { type: "number" as const, description: "ISR determinado" },
        iva_amount: { type: "number" as const, description: "IVA determinado" },
        retenciones_amount: { type: "number" as const, description: "Total retenciones" },
        // PTU (anual)
        ptu: { type: "number" as const },
        utilidad_fiscal: { type: "number" as const },
        perdida_fiscal: { type: "number" as const },
        // Acuse
        numero_operacion: { type: "string" as const, description: "Número de operación del acuse" },
        fecha_presentacion: { type: "string" as const },
        cadena_sello: { type: "string" as const },
        // Desglose completo
        desglose: {
          type: "object" as const,
          description: "Desglose completo de todos los campos extraídos del documento",
        },
        ai_summary: { type: "string" as const, description: "Resumen ejecutivo de la declaración con análisis" },
        observations: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Observaciones, alertas fiscales, variaciones vs periodos anteriores, anomalías",
        },
        confidence_score: { type: "number" as const, description: "Confianza de 0.0 a 1.0" },
      },
      required: ["document_type", "declaration_type", "rfc_emisor", "fiscal_period", "confidence_score"],
    },
  },
  {
    name: "save_bank_statement_data",
    description: "Guarda datos extraídos de un estado de cuenta bancario.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: { type: "string" as const, enum: ["estado_cuenta"] },
        banco: { type: "string" as const },
        numero_cuenta: { type: "string" as const },
        clabe: { type: "string" as const },
        rfc_emisor: { type: "string" as const, description: "RFC del titular" },
        nombre_titular: { type: "string" as const },
        document_date: { type: "string" as const, description: "Fecha del corte YYYY-MM-DD" },
        fiscal_period: { type: "string" as const, description: "Periodo YYYY-MM" },
        saldo_inicial: { type: "number" as const },
        saldo_final: { type: "number" as const },
        total_depositos: { type: "number" as const },
        total_retiros: { type: "number" as const },
        total_comisiones: { type: "number" as const },
        num_movimientos: { type: "number" as const },
        currency: { type: "string" as const },
        total_amount: { type: "number" as const, description: "Saldo final" },
        movimientos_resumen: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              fecha: { type: "string" as const },
              descripcion: { type: "string" as const },
              monto: { type: "number" as const },
              tipo: { type: "string" as const, enum: ["deposito", "retiro", "comision", "transferencia"] },
            },
          },
          description: "Resumen de movimientos principales (top 20 más relevantes)",
        },
        ai_summary: { type: "string" as const },
        observations: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Observaciones: movimientos inusuales, patrones, alertas",
        },
        confidence_score: { type: "number" as const },
      },
      required: ["document_type", "rfc_emisor", "fiscal_period", "confidence_score"],
    },
  },
  {
    name: "save_generic_document_data",
    description: "Guarda datos extraídos de un documento que no encaja en las categorías anteriores (contratos, constancias, actas, opiniones de cumplimiento, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: { type: "string" as const, description: "Tipo identificado: 'contrato', 'acta_asamblea', 'opinion_cumplimiento', 'constancia_situacion_fiscal', 'poder_notarial', 'otro'" },
        rfc_emisor: { type: "string" as const },
        document_date: { type: "string" as const },
        fiscal_period: { type: "string" as const },
        total_amount: { type: "number" as const },
        currency: { type: "string" as const },
        extracted_data: {
          type: "object" as const,
          description: "Todos los datos relevantes extraídos del documento en formato estructurado",
        },
        ai_summary: { type: "string" as const, description: "Resumen ejecutivo del documento" },
        observations: {
          type: "array" as const,
          items: { type: "string" as const },
        },
        confidence_score: { type: "number" as const },
      },
      required: ["document_type", "confidence_score"],
    },
  },
];

async function getDocumentContent(supabase: any, document: any): Promise<{ content: string; mimeType: string } | null> {
  // For Supabase-stored documents
  if (document.source === "supabase" && document.file_path) {
    const { data, error } = await supabase.storage
      .from("documents")
      .download(document.file_path);
    if (error || !data) {
      console.error("Error downloading file:", error?.message);
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    return { content: base64, mimeType: document.mime_type || "application/pdf" };
  }

  if (document.source === "dropbox" && document.external_path) {
    try {
      const accessToken = await getDropboxAccessToken();
      if (!accessToken) {
        console.error("No Dropbox credentials available for document download");
        return null;
      }
      await initDropboxTeam(accessToken);

      const downloadResp = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: dropboxDownloadHeaders(accessToken, document.external_path),
      });

      if (!downloadResp.ok) {
        console.error("Dropbox download failed:", downloadResp.status, await downloadResp.text());
        return null;
      }

      const arrayBuffer = await downloadResp.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      console.log(`Downloaded Dropbox file: ${document.external_path} (${arrayBuffer.byteLength} bytes)`);
      return { content: base64, mimeType: document.mime_type || "application/pdf" };
    } catch (err) {
      console.error("Dropbox download error:", err);
      return null;
    }
  }

  return null;
}

async function callClaude(
  apiKey: string,
  documentContent: { content: string; mimeType: string },
  documentName: string,
): Promise<any> {
  const systemPrompt = `Eres un agente especializado en extracción de datos de documentos fiscales y financieros mexicanos. Tu trabajo es:

1. **Identificar** el tipo de documento (CFDI, declaración fiscal, estado de cuenta, contrato, etc.)
2. **Extraer** TODOS los datos relevantes con precisión
3. **Analizar** la información para detectar:
   - Anomalías o inconsistencias
   - Oportunidades de optimización fiscal
   - Riesgos o alertas importantes
   - Variaciones significativas
4. **Resumir** el documento con un análisis ejecutivo útil para el despacho

## REGLAS CRÍTICAS
- Extrae TODOS los montos con exactitud decimal
- Los RFCs deben ser exactos (13 caracteres persona física, 12 persona moral)
- Las fechas en formato YYYY-MM-DD
- Los periodos fiscales en formato YYYY-MM (mensual) o YYYY (anual)
- Si no puedes leer un campo, indica confidence_score más bajo
- SIEMPRE usa la herramienta apropiada para guardar los datos
- Si el documento tiene múltiples páginas, analiza TODAS

## CONTEXTO
Trabajas para Kawiil, un despacho contable y legal en México. Los datos extraídos se usarán para:
- Análisis financiero automatizado
- Generación de reportes y dashboards
- Detección de patrones y anomalías
- Estrategia fiscal`;

  const messages: any[] = [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: documentContent.mimeType,
            data: documentContent.content,
          },
        },
        {
          type: "text",
          text: `Analiza este documento "${documentName}" y extrae toda la información relevante usando la herramienta apropiada. Identifica el tipo de documento y usa save_cfdi_data, save_declaration_data, save_bank_statement_data, o save_generic_document_data según corresponda.`,
        },
      ],
    },
  ];

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools: extractionTools,
      tool_choice: { type: "any" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error [${response.status}]: ${errText.substring(0, 500)}`);
  }

  return await response.json();
}

function mapToolResultToRecord(toolName: string, toolInput: any): Record<string, any> {
  const base: Record<string, any> = {
    document_type: toolInput.document_type || "unknown",
    rfc_emisor: toolInput.rfc_emisor || null,
    rfc_receptor: toolInput.rfc_receptor || null,
    document_date: toolInput.document_date || null,
    fiscal_period: toolInput.fiscal_period || null,
    total_amount: toolInput.total_amount || null,
    tax_amount: toolInput.tax_amount || null,
    currency: toolInput.currency || "MXN",
    isr_amount: toolInput.isr_amount || toolInput.isr_a_cargo || null,
    iva_amount: toolInput.iva_amount || toolInput.iva_a_cargo || null,
    retenciones_amount: toolInput.retenciones_amount || null,
    uuid_fiscal: toolInput.uuid_fiscal || null,
    cfdi_type: toolInput.cfdi_type || null,
    declaration_type: toolInput.declaration_type || null,
    ai_summary: toolInput.ai_summary || null,
    ai_observations: toolInput.observations || [],
    confidence_score: toolInput.confidence_score || null,
    extracted_data: toolInput, // Store the full extraction
    extraction_model: "claude-sonnet-4-20250514",
    extraction_status: "completed",
  };

  return base;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service role for backend processing
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { document_id } = await req.json();
    if (!document_id) throw new Error("document_id is required");

    console.log(`Processing document: ${document_id}`);

    // Fetch document metadata
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("*, clients(name, rfc)")
      .eq("id", document_id)
      .single();

    if (docError || !document) {
      throw new Error(`Document not found: ${docError?.message}`);
    }

    // Check if already processed
    const { data: existing } = await supabase
      .from("extracted_documents")
      .select("id")
      .eq("document_id", document_id)
      .eq("extraction_status", "completed")
      .maybeSingle();

    if (existing) {
      console.log(`Document ${document_id} already processed, skipping`);
      return new Response(JSON.stringify({ status: "already_processed", id: existing.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create or update extraction record as "processing"
    const { data: extractionRecord, error: insertErr } = await supabase
      .from("extracted_documents")
      .upsert({
        document_id,
        organization_id: document.organization_id,
        client_id: document.client_id,
        project_id: document.project_id,
        extraction_status: "processing",
      }, { onConflict: "document_id" })
      .select("id")
      .single();

    if (insertErr) {
      // If upsert fails, try insert
      console.warn("Upsert failed, trying insert:", insertErr.message);
    }

    const extractionId = extractionRecord?.id;

    // Log start
    if (extractionId) {
      await supabase.from("extraction_logs").insert({
        extracted_document_id: extractionId,
        organization_id: document.organization_id,
        action: "started",
        details: { document_name: document.name, mime_type: document.mime_type },
      });
    }

    // Get document content
    const content = await getDocumentContent(supabase, document);
    if (!content) {
      const errorMsg = "Could not retrieve document content";
      if (extractionId) {
        await supabase.from("extracted_documents")
          .update({ extraction_status: "failed", extraction_error: errorMsg })
          .eq("id", extractionId);
        await supabase.from("extraction_logs").insert({
          extracted_document_id: extractionId,
          organization_id: document.organization_id,
          action: "failed",
          details: { error: errorMsg },
        });
      }
      throw new Error(errorMsg);
    }

    // Call Claude for extraction
    const claudeResponse = await callClaude(ANTHROPIC_API_KEY, content, document.name);

    // Find tool use in response
    const toolUse = claudeResponse.content?.find((block: any) => block.type === "tool_use");
    if (!toolUse) {
      const errorMsg = "Claude did not return structured data";
      if (extractionId) {
        await supabase.from("extracted_documents")
          .update({
            extraction_status: "failed",
            extraction_error: errorMsg,
            processing_time_ms: Date.now() - startTime,
          })
          .eq("id", extractionId);
      }
      throw new Error(errorMsg);
    }

    // Map tool result to database record
    const extractedFields = mapToolResultToRecord(toolUse.name, toolUse.input);
    extractedFields.processing_time_ms = Date.now() - startTime;

    // Update the extraction record
    if (extractionId) {
      await supabase.from("extracted_documents")
        .update(extractedFields)
        .eq("id", extractionId);

      await supabase.from("extraction_logs").insert({
        extracted_document_id: extractionId,
        organization_id: document.organization_id,
        action: "completed",
        details: {
          tool_used: toolUse.name,
          document_type: extractedFields.document_type,
          confidence: extractedFields.confidence_score,
          processing_ms: extractedFields.processing_time_ms,
        },
      });
    }

    console.log(`Document ${document_id} processed successfully in ${extractedFields.processing_time_ms}ms`);

    // Auto-generate embeddings for the extracted content
    try {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (openaiKey && extractedFields.ai_summary) {
        let textToEmbed = extractedFields.ai_summary;
        if (extractedFields.document_type) textToEmbed = `[${extractedFields.document_type}] ${textToEmbed}`;
        if (extractedFields.rfc_emisor) textToEmbed += ` | RFC Emisor: ${extractedFields.rfc_emisor}`;
        if (extractedFields.rfc_receptor) textToEmbed += ` | RFC Receptor: ${extractedFields.rfc_receptor}`;
        if (extractedFields.fiscal_period) textToEmbed += ` | Periodo: ${extractedFields.fiscal_period}`;

        const embResp = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: textToEmbed.replace(/\n+/g, " ").trim(),
            model: "text-embedding-3-small",
            dimensions: 1536,
          }),
        });

        if (embResp.ok) {
          const embData = await embResp.json();
          const embedding = embData.data[0].embedding;
          await supabase.from("document_chunks").insert({
            organization_id: document.organization_id,
            document_id: document_id,
            client_id: document.client_id || null,
            project_id: document.project_id || null,
            source_type: "extracted_data",
            source_id: extractionId,
            content: textToEmbed,
            metadata: {
              document_type: extractedFields.document_type,
              rfc_emisor: extractedFields.rfc_emisor,
              confidence: extractedFields.confidence_score,
            },
            embedding: JSON.stringify(embedding),
            token_count: Math.ceil(textToEmbed.length / 3.5),
          });
          console.log(`Embedding generated for extraction ${extractionId}`);
        }
      }
    } catch (embError) {
      console.error("Auto-embedding failed (non-blocking):", embError);
    }

    return new Response(JSON.stringify({
      status: "completed",
      id: extractionId,
      document_type: extractedFields.document_type,
      confidence: extractedFields.confidence_score,
      processing_ms: extractedFields.processing_time_ms,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-document error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
