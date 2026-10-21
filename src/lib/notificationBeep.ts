/**
 * Sonido de aviso in-app (Web Audio API), modo zen: golpe suave de madera en registro grave-medio,
 * dos notas que suben con calma, menos de un segundo, sin brillo ni agudos. Pensado para oírse
 * todos los días sin cansar: avisa que hay algo y ya. Sin ondas cuadradas (nada de videojuego).
 * Puede fallar silenciosamente si el navegador bloquea audio hasta gesto del usuario.
 */

export type NotificationSoundVariant = "madera" | "gota" | "bruma";

type Voice = {
  /** [múltiplo de frecuencia, ganancia relativa, vida relativa] */
  partials: ReadonlyArray<readonly [number, number, number]>;
  attack: number;
  decay: number;
  /** Notas (Hz) y desfase entre ellas (s). */
  notes: ReadonlyArray<readonly [number, number]>;
  /** Corte del filtro pasa-bajos: mantiene el sonido redondo, sin brillo ni agudos. */
  cutoff: number;
};

// Registro grave-medio a propósito: se escucha todos los días y no debe cansar.
const C4 = 261.63;
const D4 = 293.66;
const F4 = 349.23;
const G4 = 392.0;

const VOICES: Record<NotificationSoundVariant, Voice> = {
  // Golpe suave de madera hueca, dos notas que suben una cuarta (Do4–Fa4).
  madera: {
    partials: [[1, 1, 1], [2.0, 0.28, 0.5], [4.0, 0.05, 0.2]],
    attack: 0.012,
    decay: 0.55,
    notes: [[C4, 0], [F4, 0.14]],
    cutoff: 1600,
  },
  // Una sola nota redonda, como una gota en agua tibia.
  gota: {
    partials: [[1, 1, 1], [2.0, 0.1, 0.4]],
    attack: 0.02,
    decay: 0.6,
    notes: [[D4, 0]],
    cutoff: 1400,
  },
  // Dos notas casi sinusoidales, muy suaves y un poco más largas.
  bruma: {
    partials: [[1, 1, 1], [2.0, 0.06, 0.4]],
    attack: 0.03,
    decay: 0.8,
    notes: [[C4, 0], [G4, 0.18]],
    cutoff: 1200,
  },
};

export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundVariant = "madera";

/** Eco de sala corto generado con ruido decreciente (sin archivos). */
function makeRoom(ctx: AudioContext, seconds = 0.9): ConvolverNode {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function scheduleNote(
  ctx: AudioContext,
  dest: AudioNode,
  voice: Voice,
  frequency: number,
  startTime: number,
  peakGain: number,
) {
  const eps = 0.0001;
  for (const [ratio, level, life] of voice.partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * ratio, startTime);
    const tEnd = startTime + voice.decay * life;
    gain.gain.setValueAtTime(eps, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(peakGain * level, eps), startTime + voice.attack);
    gain.gain.exponentialRampToValueAtTime(eps, tEnd);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(tEnd + 0.03);
  }
}

export function playNotificationBeep(variant: NotificationSoundVariant = DEFAULT_NOTIFICATION_SOUND): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const voice = VOICES[variant] ?? VOICES[DEFAULT_NOTIFICATION_SOUND];

    const run = () => {
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);

      // Quita el brillo: solo queda la parte redonda del sonido.
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = voice.cutoff;
      tone.connect(master);

      const wet = ctx.createGain();
      wet.gain.value = 0.15;
      const room = makeRoom(ctx, 0.5);
      room.connect(wet);
      wet.connect(master);

      const bus = ctx.createGain();
      bus.connect(tone);
      bus.connect(room);

      const t0 = ctx.currentTime + 0.02;
      voice.notes.forEach(([freq, offset], i) => {
        scheduleNote(ctx, bus, voice, freq, t0 + offset, 0.3 - i * 0.03);
      });

      const last = voice.notes[voice.notes.length - 1][1];
      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, Math.ceil((last + voice.decay + 0.7) * 1000));
    };

    const p = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    void p.then(run).catch(run);
  } catch {
    /* ignore */
  }
}
