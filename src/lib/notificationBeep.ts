/** Pitido muy corto para avisos; puede fallar silenciosamente por políticas de autoplay del navegador. */
export function playNotificationBeep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.start(t0);
    osc.stop(t0 + 0.15);
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 300);
  } catch {
    /* ignore */
  }
}
