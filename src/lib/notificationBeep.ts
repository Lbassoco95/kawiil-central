/**
 * Sonido de aviso in-app (Web Audio API). Dos tonos tipo “campanilla”, más largo y fuerte que un pitido corto.
 * Puede fallar silenciosamente si el navegador bloquea audio hasta gesto del usuario.
 */
function scheduleTone(
  ctx: AudioContext,
  dest: AudioNode,
  frequency: number,
  startTime: number,
  durationSec: number,
  peakGain: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(frequency, startTime);
  const tEnd = startTime + durationSec;
  const eps = 0.0001;
  gain.gain.setValueAtTime(eps, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(peakGain, eps), startTime + 0.045);
  gain.gain.exponentialRampToValueAtTime(Math.max(peakGain * 0.88, eps), startTime + durationSec * 0.5);
  gain.gain.exponentialRampToValueAtTime(eps, tEnd);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startTime);
  osc.stop(tEnd + 0.03);
}

export function playNotificationBeep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const run = () => {
      const master = ctx.createGain();
      master.gain.value = 0.92;
      master.connect(ctx.destination);

      const t0 = ctx.currentTime + 0.02;
      // Primer golpe: más fuerte y ~240 ms
      scheduleTone(ctx, master, 880, t0, 0.24, 0.34);
      // Segundo golpe: quinta arriba, perceptible “notificación”
      scheduleTone(ctx, master, 1320, t0 + 0.3, 0.28, 0.3);

      const closeAfter = Math.ceil((0.3 + 0.28 + 0.15) * 1000) + 120;
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
