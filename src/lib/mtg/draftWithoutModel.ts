/**
 * Borrador de minuta sin modelo (solo capturado en vivo).
 */

import { buildMinutesMarkdown } from "@/lib/mtg/generateMinutes";

export function buildDraftWithoutModel(opts: {
  title: string;
  scheduledAt: string;
  attendees?: string[];
  liveAgreements: { text: string; status: string }[];
  decided: { text: string; resolution: string | null }[];
  topicLines?: string[];
  expectedNext?: string[];
}): string {
  const base = buildMinutesMarkdown({
    title: opts.title,
    scheduledAt: opts.scheduledAt,
    attendees: opts.attendees ?? [],
    liveAgreements: opts.liveAgreements,
    decided: opts.decided,
    model: null,
  });

  const extra: string[] = [];
  if (opts.topicLines && opts.topicLines.length > 0) {
    extra.push("", "## Temas revisados (tablero)", ...opts.topicLines.map((t) => `- ${t}`));
  }
  if (opts.expectedNext && opts.expectedNext.length > 0) {
    extra.push("", "## Temas para la próxima", ...opts.expectedNext.map((t) => `- ${t}`));
  } else {
    extra.push("", "## Temas para la próxima", "- (pendiente de enriquecer con el modelo)");
  }
  extra.push(
    "",
    "_Borrador sin modelo — el worker enriquecerá con la transcripción cuando esté disponible._",
  );
  return `${base}${extra.join("\n")}`;
}
