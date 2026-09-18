/**
 * Generación de minuta (B4) — el markdown se arma en código;
 * el modelo (vía gateway) solo propone JSON estructurado.
 */

import { z } from "zod";

export const MinutesModelOutputSchema = z.object({
  summary_by_topic: z.array(
    z.object({ topic_id: z.string(), summary: z.string() }),
  ),
  decisions: z.array(z.string()),
  proposed_agreements: z.array(
    z.object({
      text: z.string(),
      entity_key: z.string().nullable(),
      owner_side: z.enum(["kawiil", "client", "both"]).nullable().optional(),
      owner_hint: z.string().nullable(),
      due_hint: z.string().nullable(),
      project_hint: z.string().nullable(),
      project_reason: z.string().nullable(),
      transcript_ref: z.string(),
      confidence: z.number(),
    }),
  ),
  project_hints_for_amber: z.array(
    z.object({
      agreement_id: z.string(),
      project_hint: z.string().nullable(),
      project_reason: z.string().nullable(),
    }),
  ),
  open_questions: z.array(z.string()),
  next_meeting_topics: z.array(z.string()),
});

export type MinutesModelOutput = z.infer<typeof MinutesModelOutputSchema>;

export const MOCK_MINUTES_OUTPUT: MinutesModelOutput = {
  summary_by_topic: [
    { topic_id: "00000000-0000-4000-8000-000000000001", summary: "Se revisó avance y quedó pendiente documentación." },
  ],
  decisions: ["Se aprueba continuar con el plan acordado."],
  proposed_agreements: [
    {
      text: "Enviar borrador de respuesta antes del viernes",
      entity_key: "demo",
      owner_side: "kawiil",
      owner_hint: null,
      due_hint: null,
      project_hint: null,
      project_reason: null,
      transcript_ref: "00:12:04",
      confidence: 0.82,
    },
    {
      text: "Cliente confirma fecha de entrega de evidencias",
      entity_key: "demo",
      owner_side: "client",
      owner_hint: "Contacto cliente",
      due_hint: null,
      project_hint: null,
      project_reason: null,
      transcript_ref: "00:18:40",
      confidence: 0.77,
    },
  ],
  project_hints_for_amber: [],
  open_questions: ["¿Hay dependencia de tercero?"],
  next_meeting_topics: ["Revisar evidencias recibidas"],
};

export function buildMinutesMarkdown(opts: {
  title: string;
  scheduledAt: string;
  attendees: string[];
  liveAgreements: { text: string; status: string }[];
  decided: { text: string; resolution: string | null }[];
  model: MinutesModelOutput | null;
}): string {
  const lines: string[] = [];
  lines.push(`# Minuta — ${opts.title}`);
  lines.push("");
  lines.push(`**Fecha:** ${opts.scheduledAt}`);
  lines.push(`**Asistentes:** ${opts.attendees.join(", ") || "—"}`);
  lines.push("");
  lines.push("## Acuerdos capturados en vivo");
  for (const a of opts.liveAgreements) {
    lines.push(`- [${a.status}] ${a.text}`);
  }
  if (opts.liveAgreements.length === 0) lines.push("- (ninguno)");
  lines.push("");
  lines.push("## Decisiones");
  for (const d of opts.decided) {
    lines.push(`- ${d.text}${d.resolution ? ` → ${d.resolution}` : ""}`);
  }
  if (opts.model) {
    lines.push("");
    lines.push("## Resumen por tema (modelo)");
    for (const s of opts.model.summary_by_topic) {
      lines.push(`- ${s.summary}`);
    }
    lines.push("");
    lines.push("## Acuerdos propuestos (pendientes de confirmar)");
    for (const p of opts.model.proposed_agreements) {
      lines.push(`- ${p.text} _(ref ${p.transcript_ref})_`);
    }
    lines.push("");
    lines.push("## Preguntas abiertas");
    for (const q of opts.model.open_questions) lines.push(`- ${q}`);
    lines.push("");
    lines.push("## Temas para la próxima");
    for (const t of opts.model.next_meeting_topics) lines.push(`- ${t}`);
  }
  return lines.join("\n");
}

export async function callOpenClawGateway(opts: {
  gatewayUrl: string;
  token?: string;
  system: string;
  user: string;
  mock?: boolean;
}): Promise<MinutesModelOutput> {
  if (opts.mock || processEnv("MTG_GATEWAY_MOCK") === "1") {
    return MOCK_MINUTES_OUTPUT;
  }
  const res = await fetch(`${opts.gatewayUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({
      model: "default",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  return MinutesModelOutputSchema.parse(parsed);
}

function processEnv(k: string): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k];
  } catch {
    return undefined;
  }
}
