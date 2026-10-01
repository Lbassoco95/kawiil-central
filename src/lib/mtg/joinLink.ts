/**
 * Normaliza y valida links de videollamada (Teams / Meet / Zoom…)
 * para asociarlos a una junta Múuch' ya en curso.
 */

export type MeetingJoinProvider =
  | "teams"
  | "google_meet"
  | "zoom"
  | "webex"
  | "other";

export type ParsedMeetingJoinLink = {
  url: string;
  provider: MeetingJoinProvider;
  label: string;
  /** Id de reunión Teams si se puede extraer del path (para Graph/transcripts). */
  teamsOnlineMeetingId: string | null;
};

const LABEL: Record<MeetingJoinProvider, string> = {
  teams: "Teams",
  google_meet: "Google Meet",
  zoom: "Zoom",
  webex: "Webex",
  other: "Videollamada",
};

function providerFromHost(host: string): MeetingJoinProvider {
  const h = host.toLowerCase();
  if (h.includes("teams.microsoft") || h.includes("teams.live")) return "teams";
  if (h.includes("meet.google")) return "google_meet";
  if (h.includes("zoom.us") || h.includes("zoom.com")) return "zoom";
  if (h.includes("webex")) return "webex";
  return "other";
}

/** Extrae el primer http(s) de un texto pegado (puede traer basura alrededor). */
export function extractUrlFromPaste(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[),.]+$/, "");
  // Sin esquema: permitir teams.microsoft.com/... o meet.google.com/...
  if (/^(teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|[\w.-]+\.zoom\.us)\//i.test(t)) {
    return `https://${t}`;
  }
  return null;
}

/**
 * Del join URL de Teams intenta recuperar el thread/meeting id
 * (`19:meeting_…@thread.v2`), útil para matching de transcripciones Graph.
 */
export function extractTeamsOnlineMeetingId(url: string): string | null {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    // /l/meetup-join/19:meeting_xxx@thread.v2/0
    const m = path.match(/meetup-join\/([^/]+)/i);
    if (!m?.[1]) return null;
    const id = m[1].trim();
    if (id.startsWith("19:") || id.includes("meeting_")) return id;
    return id || null;
  } catch {
    return null;
  }
}

export function parseMeetingJoinLink(raw: string): ParsedMeetingJoinLink {
  const extracted = extractUrlFromPaste(raw);
  if (!extracted) {
    throw new Error("Pega un enlace válido (https://teams.microsoft.com/… o Meet/Zoom).");
  }
  let u: URL;
  try {
    u = new URL(extracted);
  } catch {
    throw new Error("El enlace no es una URL válida.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("El enlace debe ser http(s).");
  }
  const provider = providerFromHost(u.hostname);
  const teamsOnlineMeetingId =
    provider === "teams" ? extractTeamsOnlineMeetingId(u.toString()) : null;
  return {
    url: u.toString(),
    provider,
    label: LABEL[provider],
    teamsOnlineMeetingId,
  };
}
