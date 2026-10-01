/**
 * Qué hay conectado hoy para capturar una junta — y qué NO hace el “cerebro” de Hetzner.
 *
 * Hetzner (openclaw-gateway + kawiil-agents):
 *   - LLM de minutas / agentes (dispatch-to-agent, worker/mtg → /v1/chat/completions)
 *   - NO entra a Teams/Meet/Zoom a grabar
 *
 * Captura real hoy:
 *   1) Browser: Grabar audio / Audio de llamada → bucket mtg → Whisper
 *   2) Teams nativo: grabas en Teams → después extraemos (Graph; app consent pendiente)
 *   3) Bot que se une (Recall / Kawiilito join): roadmap — no hay API ni secretos
 */

export type KawiilitoCapturePath =
  | "browser_audio"
  | "teams_native_then_extract"
  | "bot_join_roadmap";

export type KawiilitoCapabilitySnapshot = {
  /** URL de la reunión ya pegada en la junta. */
  hasJoinUrl: boolean;
  /** Id Graph de onlineMeeting si se pudo parsear del link. */
  hasTeamsOnlineMeetingId: boolean;
  /** Junta en estado donde tiene sentido grabar. */
  meetingReady: boolean;
  /** Hetzner/openclaw sirve para minutas tras tener transcript — no para entrar a la call. */
  hetznerBrainForMinutes: true;
  /** Bot que se une a la call: no conectado. */
  botJoinConnected: false;
  /** Graph auto-pull de recording/transcript: stub 501 hasta admin consent. */
  graphAutoExtractReady: false;
  recommended: KawiilitoCapturePath;
  lines: string[];
};

export function assessKawiilitoCapabilities(opts: {
  status: string;
  teamsJoinUrl: string | null | undefined;
  teamsOnlineMeetingId: string | null | undefined;
}): KawiilitoCapabilitySnapshot {
  const hasJoinUrl = !!(opts.teamsJoinUrl && opts.teamsJoinUrl.trim());
  const hasTeamsOnlineMeetingId = !!(
    opts.teamsOnlineMeetingId && opts.teamsOnlineMeetingId.trim()
  );
  const meetingReady = opts.status === "planned" || opts.status === "in_progress";

  let recommended: KawiilitoCapturePath = "browser_audio";
  if (hasJoinUrl) recommended = "teams_native_then_extract";

  const lines: string[] = [];
  lines.push(
    "El cerebro de Hetzner (openclaw / kawiil-agents) genera minutas y tareas de agente; no entra a la llamada.",
  );
  if (!meetingReady) {
    lines.push("Esta junta debe estar programada o en curso.");
  }
  if (!hasJoinUrl) {
    lines.push("Pega el link de Teams de esta reunión (ya creada) para unirte y grabar ahí.");
  } else {
    lines.push(
      "Con el link: únete a Teams, graba en Teams (o Audio de llamada aquí). La grabación queda en Teams o en Storage; luego transcribimos / minuta con el cerebro.",
    );
  }
  if (hasTeamsOnlineMeetingId) {
    lines.push(
      "Hay id de reunión Teams capturado: cuando Graph tenga admin consent, podremos extraer grabación/transcripción sin bot.",
    );
  } else {
    lines.push(
      "Extracción automática Graph y bot que se une (Recall/Kawiilito) aún no están: hace falta consent de Polo o un proveedor de bot.",
    );
  }

  return {
    hasJoinUrl,
    hasTeamsOnlineMeetingId,
    meetingReady,
    hetznerBrainForMinutes: true,
    botJoinConnected: false,
    graphAutoExtractReady: false,
    recommended,
    lines,
  };
}
