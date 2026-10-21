/**
 * Sonido de aviso in-app (Web Audio API), modo zen: un tazón grave y cálido con dos notas
 * de la escala pentatónica (re–la, una octava abajo), ataque suave pero directo y cola corta.
 * Solo avisa que hay algo; volumen bajo a propósito.
 * Puede fallar silenciosamente si el navegador bloquea audio hasta gesto del usuario.
 */

// Parciales de un tazón/campana: [múltiplo de frecuencia, ganancia relativa, duración relativa]
const BOWL_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 1],
  [2.76, 0.16, 0.4],
  [5.4, 0.04, 0.2],
];

function scheduleBowl(
  ctx: AudioContext,
  dest: AudioNode,
  frequency: number,
  startTime: number,
  durationSec: number,
  peakGain: number,
) {
  const eps = 0.0001;
  for (const [ratio, level, life] of BOWL_PARTIALS) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * ratio, startTime);
    const tEnd = startTime + durationSec * life;
    gain.gain.setValueAtTime(eps, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(peakGain * level, eps), startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(eps, tEnd);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(tEnd + 0.03);
  }
}

export function playNotificationBeep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const run = () => {
      const master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);

      const t0 = ctx.currentTime + 0.02;
      scheduleBowl(ctx, master, 293.66, t0, 1.1, 0.34); // Re4
      scheduleBowl(ctx, master, 440, t0 + 0.2, 1.3, 0.28); // La4

      const closeAfter = Math.ceil((0.2 + 1.3 + 0.2) * 1000);
      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, closeAfter);
    };

    const p = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    void p.then(run).catch(run);
  } catch {
    /* ignore */
  }
}
