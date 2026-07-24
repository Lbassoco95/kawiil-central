// sw-brief — webhook post-llamada de ElevenLabs. Con Claude Sonnet genera un
// brief estructurado, lo guarda en switchboard_call, avisa al G4 (notify:
// notifications in-app + DM de Slack best-effort) y crea una tarea de seguimiento
// en public.tasks asignada al G4.
//
// Ruta urgente: si el SIP REFER no conectó en 15s (transfer.connected=false),
// el brief lleva bandera roja 🔴 y el aviso lo remarca.
//
// Integración Finanzas: si la célula es CONT y el motivo es de pago/cobranza,
// intenta ligar el folio al cliente (public.clients) y anexa su estado de cartera
// (al día / vencido) leído de Savio (best-effort, se degrada si no está disponible).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, checkWebhookAuth } from "../_shared/switchboard-http.ts";
import { callAnthropicText, MODEL_SONNET } from "../_shared/anthropic.ts";
import { savioAuthorizationHeaderValue } from "../_shared/savioAuthHeaders.ts";
import { normalizeSavioApiBase } from "../_shared/savioApiBase.ts";
import {
  buildBriefText,
  CELULA_LABELS,
  esPagoOCobranza,
  isCelula,
  rutaFromUrgencia,
  severityEmoji,
  taskPriorityFromUrgencia,
  urgenciaFromFlags,
  type Celula,
} from "../_shared/conmutador.ts";

const DEFAULT_ORG = "a0000000-0000-0000-0000-000000000001";

// deno-lint-ignore no-explicit-any
type Admin = any;

// Resumen del motivo (2–3 líneas) con Sonnet; si falla, usa el motivo crudo.
async function resumirMotivo(
  apiKey: string | undefined,
  motivo: string,
  transcript: string,
): Promise<string> {
  const base = (motivo || transcript || "").trim();
  if (!apiKey || !base) return base || "Sin motivo capturado.";
  try {
    const system =
      "Resume en 2–3 líneas, en español neutro y profesional, el motivo de una " +
      "llamada a un despacho legal-contable. Sé concreto y accionable; no inventes " +
      "datos. Devuelve solo el resumen, sin encabezados.";
    const user =
      `Motivo declarado: ${motivo || "(no especificado)"}\n\n` +
      `Transcripción:\n"""${(transcript || "").slice(0, 8000)}"""`;
    const out = await callAnthropicText({
      apiKey,
      model: MODEL_SONNET,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 220,
    });
    return out || base;
  } catch (e) {
    console.warn("sw-brief: resumen Sonnet falló, uso motivo crudo:", String(e));
    return base;
  }
}

// Empareja el llamante/empresa con un cliente de la org. Primero por alias
// (public.client_alias, match exacto case-insensitive) y luego por nombre
// (clients.name, ilike). Devuelve el cliente con su savio_customer_id.
async function matchCliente(
  admin: Admin,
  org: string,
  empresa: string,
  llamante: string,
): Promise<{ id: string; savio_customer_id: string | null } | null> {
  const candidatos = [empresa, llamante].map((s) => (s || "").trim()).filter(Boolean);
  if (candidatos.length === 0) return null;

  // 1) Alias exacto (case-insensitive) → client_id.
  for (const nombre of candidatos) {
    const { data } = await admin
      .from("client_alias")
      .select("client_id, clients:client_id(id, savio_customer_id)")
      .eq("organization_id", org)
      .ilike("alias", nombre)
      .limit(1);
    const cli = data?.[0]?.clients;
    if (cli) return { id: cli.id, savio_customer_id: cli.savio_customer_id ?? null };
  }

  // 2) Nombre del cliente (coincidencia parcial).
  for (const nombre of candidatos) {
    const { data } = await admin
      .from("clients")
      .select("id, savio_customer_id")
      .eq("organization_id", org)
      .ilike("name", `%${nombre}%`)
      .limit(1);
    if (data && data.length > 0) return data[0];
  }
  return null;
}

// Estado de cartera del cliente en Savio (best-effort): 'vencido' si hay facturas
// con atraso, 'al_dia' si no, null si Savio no está configurado o falla.
async function carteraEstado(savioCustomerId: string | null): Promise<string | null> {
  if (!savioCustomerId) return null;
  const base = normalizeSavioApiBase(Deno.env.get("SAVIO_API_BASE_URL") || "");
  const apiKey = Deno.env.get("SAVIO_API_KEY");
  if (!base || !apiKey) return null;
  try {
    const url =
      `${base}/invoice?customer_id=${encodeURIComponent(savioCustomerId)}` +
      `&min_days_late=1&limit=1`;
    const resp = await fetch(url, {
      headers: { Authorization: savioAuthorizationHeaderValue(apiKey) },
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const items = Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
    return Array.isArray(items) && items.length > 0 ? "vencido" : "al_dia";
  } catch (e) {
    console.warn("sw-brief: cartera Savio no disponible:", String(e));
    return null;
  }
}

// notify: fila in-app + DM de Slack best-effort (mismo mecanismo que RH/liquidez).
async function notifyG4(
  admin: Admin,
  g4Id: string,
  org: string,
  title: string,
  briefText: string,
  callId: string,
) {
  // (a) notificación in-app (canal interno primario, con realtime).
  await admin.from("notifications").insert({
    user_id: g4Id,
    organization_id: org,
    title,
    body: briefText.slice(0, 1000),
    type: "conmutador",
    entity_type: "switchboard_call",
    entity_id: callId,
    is_read: false,
  });

  // (b) DM de Slack (best-effort).
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) return;
  try {
    const { data: conn } = await admin
      .from("user_slack_connections")
      .select("slack_user_id")
      .eq("user_id", g4Id)
      .maybeSingle();
    const slackId = conn?.slack_user_id;
    if (!slackId) return;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: slackId, text: `${title}\n\n${briefText}` }),
    });
  } catch (e) {
    console.warn("sw-brief: DM de Slack falló:", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauth = checkWebhookAuth(req);
  if (unauth) return unauth;

  try {
    const body = await req.json().catch(() => ({}));
    const org: string = typeof body.organization_id === "string" ? body.organization_id : DEFAULT_ORG;
    const celula: Celula | null = isCelula(body.celula) ? body.celula : null;
    const motivo: string = typeof body.motivo === "string" ? body.motivo : "";
    const transcript: string = typeof body.transcript === "string" ? body.transcript : "";
    const llamante: string = typeof body.llamante === "string" ? body.llamante : "";
    const empresa: string = typeof body.empresa === "string" ? body.empresa : "";
    const urgente = Boolean(body.urgente);
    const urgencia = urgenciaFromFlags(urgente);
    const ruta = rutaFromUrgencia(urgencia);
    const transferConnected = body?.transfer?.connected;
    const transferenciaFallida = ruta === "urgente" && transferConnected === false;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

    // 1) Folio: usa el recibido o genera uno atómico.
    let folio: string | null = typeof body.folio === "string" ? body.folio : null;
    if (!folio) {
      const { data: f } = await admin.rpc("next_switchboard_folio", {
        p_anio: new Date().getUTCFullYear(),
      });
      folio = f ?? null;
    }

    // 2) G4 destino desde v_g4_por_celula (catálogo de RH).
    let g4Id: string | null = null;
    let g4Nombre = "";
    if (celula) {
      const { data: g4 } = await admin
        .from("v_g4_por_celula")
        .select("g4_id, g4_nombre")
        .eq("organization_id", org)
        .eq("celula", celula)
        .maybeSingle();
      g4Id = g4?.g4_id ?? null;
      g4Nombre = g4?.g4_nombre ?? "";
    }

    // 3) Integración Finanzas (CONT + pago/cobranza).
    let clientId: string | null = null;
    let cartera: string | null = null;
    if (celula === "CONT" && esPagoOCobranza(motivo)) {
      const cli = await matchCliente(admin, org, empresa, llamante);
      if (cli) {
        clientId = cli.id;
        cartera = await carteraEstado(cli.savio_customer_id);
      }
    }

    // 4) Resumen del motivo (Sonnet) + armado del brief.
    const motivoResumen = await resumirMotivo(apiKey, motivo, transcript);
    const briefText = buildBriefText({
      urgencia,
      folio: folio ?? "(sin folio)",
      celula,
      llamante,
      empresa,
      telefono: body.telefono ?? null,
      correo: body.correo ?? null,
      motivoResumen,
      transcriptUrl: body.transcript_url ?? null,
      recordingUrl: body.recording_url ?? null,
      carteraEstado: cartera,
      transferenciaFallida,
    });

    // 5) Persistir la llamada.
    const callRow = {
      organization_id: org,
      folio,
      celula,
      urgencia,
      llamante: llamante || null,
      empresa: empresa || null,
      es_cliente: typeof body.es_cliente === "boolean" ? body.es_cliente : null,
      telefono: body.telefono ?? null,
      correo: body.correo ?? null,
      motivo: motivo || null,
      ruta,
      g4_id: g4Id,
      transferido: transferConnected === true,
      client_id: clientId,
      cartera_estado: cartera,
      brief: briefText,
      conversation_id: body.conversation_id ?? null,
      transcript_url: body.transcript_url ?? null,
      recording_url: body.recording_url ?? null,
    };

    // Upsert por folio (idempotente ante reintentos del webhook). Traemos también
    // followup_task_id para no duplicar tarea/aviso si ElevenLabs reenvía.
    const { data: saved, error: saveErr } = await admin
      .from("switchboard_call")
      .upsert(callRow, { onConflict: "folio" })
      .select("id, followup_task_id")
      .single();
    if (saveErr) return jsonResponse({ error: `No se pudo guardar la llamada: ${saveErr.message}` }, 500);
    const callId = saved.id as string;

    // Reintento del webhook: la llamada ya tiene tarea/aviso → respuesta idempotente.
    if (saved.followup_task_id) {
      return jsonResponse({
        ok: true,
        idempotent: true,
        folio,
        call_id: callId,
        followup_task_id: saved.followup_task_id,
      });
    }

    // 6) Tarea de seguimiento en public.tasks asignada al G4.
    let taskId: string | null = null;
    if (g4Id) {
      const titulo =
        `${severityEmoji(urgencia)} Seguimiento ${folio} · ` +
        (celula ? CELULA_LABELS[celula] : "Conmutador");
      const { data: task } = await admin
        .from("tasks")
        .insert({
          organization_id: org,
          title: titulo.slice(0, 200),
          description: briefText,
          assigned_to: g4Id,
          priority: taskPriorityFromUrgencia(urgencia),
          status: "pendiente",
          client_id: clientId,
        })
        .select("id")
        .single();
      taskId = task?.id ?? null;
      if (taskId) {
        await admin.from("switchboard_call").update({ followup_task_id: taskId }).eq("id", callId);
      }

      // 7) notify al G4 (best-effort: nunca debe tumbar el webhook ya persistido).
      const notiTitle = transferenciaFallida
        ? `🔴 Llamada urgente sin transferir · ${folio}`
        : `${severityEmoji(urgencia)} Nueva llamada · ${folio}`;
      try {
        await notifyG4(admin, g4Id, org, notiTitle, briefText, callId);
      } catch (e) {
        console.warn("sw-brief: notify al G4 falló (best-effort):", String(e));
      }
    } else {
      console.warn(`sw-brief: sin G4 para célula ${celula}; no se creó tarea ni aviso.`);
    }

    return jsonResponse({
      ok: true,
      folio,
      call_id: callId,
      g4_id: g4Id,
      g4_nombre: g4Nombre,
      followup_task_id: taskId,
      urgencia,
      ruta,
      cliente_ligado: clientId,
      cartera,
      transferencia_fallida: transferenciaFallida,
      notificado: Boolean(g4Id),
    });
  } catch (e) {
    console.error("sw-brief error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
