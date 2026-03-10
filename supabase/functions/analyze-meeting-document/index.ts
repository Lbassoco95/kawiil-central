import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.10.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function extractPdfText(fileBase64: string): Promise<string> {
  const bytes = base64ToUint8Array(fileBase64);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return (text || "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) throw new Error("Profile not found");

    const body = await req.json();
    const { content, file_base64, filename, project_id, client_id, area } = body;

    let textToAnalyze: string;

    if (file_base64 && (filename || "").toLowerCase().endsWith(".pdf")) {
      try {
        textToAnalyze = await extractPdfText(file_base64);
      } catch (e) {
        console.error("PDF extraction error:", e);
        return new Response(
          JSON.stringify({ error: "No se pudo extraer el texto del PDF. Si es una imagen escaneada, pega el contenido en el cuadro de texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!textToAnalyze) {
        return new Response(
          JSON.stringify({ error: "El PDF no contiene texto legible (por ejemplo, es una imagen escaneada). Pega el contenido en el cuadro de texto." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (content && typeof content === "string" && content.trim()) {
      textToAnalyze = content.trim();
    } else {
      return new Response(JSON.stringify({ error: "Envía contenido de texto o un PDF en file_base64 con filename .pdf" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: teamMembers } = await supabase
      .from("profiles")
      .select("user_id, full_name, area")
      .eq("organization_id", profile.organization_id)
      .eq("is_active", true);

    const teamList = (teamMembers || [])
      .map((m) => `- ${m.full_name} (ID: ${m.user_id}, área: ${m.area || "sin área"})`)
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `Eres un asistente experto en gestión de proyectos para un despacho contable y legal en México llamado Kawiil.

Tu tarea es ANALIZAR A DETALLE el documento/minuta/reunión y proponer tareas listas para validar y crear directamente en el proyecto. El usuario revisará tu propuesta y creará las tareas en el sistema.

EQUIPO DISPONIBLE:
${teamList}

FECHA ACTUAL: ${today}

INSTRUCCIONES:
1. Analiza a fondo todo el contenido: compromisos, acuerdos, plazos y responsables mencionados.
2. Para cada tarea que identifiques, propón:
   - title: Nombre claro de la tarea, listo para usarse como título en el proyecto (concreto y accionable).
   - description: Descripción breve con contexto para quien ejecute la tarea.
   - priority: "urgente", "alta", "media" o "baja" según el documento y el impacto.
   - due_date: Fecha de vencimiento propuesta en YYYY-MM-DD (usa las fechas indicadas en el documento o estima una razonable).
   - assigned_to_name y assigned_to_id: Si en el documento se menciona a alguien del equipo por nombre, asigna su user_id de la lista; si no, null.
3. Incluye TODAS las tareas, compromisos y pendientes que encuentres. Cada una debe tener título y fecha de vencimiento propuesta para que el usuario pueda validarlas y crearlas directamente.
4. Responde EXCLUSIVAMENTE con el JSON solicitado, sin texto adicional antes ni después.

RESPONDE con un JSON válido con esta estructura exacta:
{
  "summary": "Resumen breve de la reunión o documento en 2-3 oraciones",
  "tasks": [
    {
      "title": "Nombre claro de la tarea",
      "description": "Descripción breve con contexto",
      "priority": "media",
      "due_date": "YYYY-MM-DD",
      "assigned_to_name": "Nombre de la persona o null",
      "assigned_to_id": "UUID del usuario o null"
    }
  ]
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Analiza el siguiente documento/minuta y extrae las tareas:\n\n${textToAnalyze}`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes excedido. Intenta de nuevo en unos minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error al analizar con AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const textContent = aiResponse.content?.[0]?.text || "";

    let parsed;
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Failed to parse AI response:", textContent);
      return new Response(JSON.stringify({ error: "Error al interpretar la respuesta de AI", raw: textContent }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tasks = (parsed.tasks || []).map((t: any) => ({
      ...t,
      project_id: project_id || null,
      client_id: client_id || null,
      area: area || null,
    }));

    const result: { text?: string; summary: string; tasks: any[] } = {
      summary: parsed.summary,
      tasks,
    };
    if (file_base64) result.text = textToAnalyze;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-meeting-document error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
