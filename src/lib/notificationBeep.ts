/**
 * Sonido de aviso in-app (Web Audio API), modo zen y alegre: notas de kalimba/marimba suaves
 * con caída natural y un toque de eco de sala. Sin ondas cuadradas ni arpegios rápidos (nada de
 * "videojuego"): dos o tres notas pentatónicas mayores que suben con calma, volumen bajo.
 * Puede fallar silenciosamente si el navegador bloquea audio hasta gesto del usuario.
 */

export type NotificationSoundVariant = "kalimba" | "marimba" | "campanillas";

type Voice = {
  /** [múltiplo de frecuencia, ganancia relativa, vida relativa] */
  partials: ReadonlyArray<readonly [number, number, number]>;
  attack: number;
  decay: number;
  /** Notas (Hz) y desfase entre ellas (s). */
  notes: ReadonlyArray<readonly [number, number]>;
};

// Pentatónica mayor de Sol: Sol4, Si4, Re5, Sol5
const G4 = 392.0;
const B4 = 493.88;
const D5 = 587.33;
const G5 = 783.99;

const VOICES: Record<NotificationSoundVariant, Voice> = {
  // Pulsada y redonda, como una caja de música de madera.
  kalimba: {
    partials: [[1, 1, 1], [4.0, 0.22, 0.35], [9.2, 0.05, 0.15]],
    attack: 0.006,
    decay: 1.1,
    notes: [[G4, 0], [B4, 0.16], [D5, 0.32]],
  },
  // Más cálida y hueca.
  marimba: {
    partials: [[1, 1, 1], [3.97, 0.3, 0.3], [10.0, 0.05, 0.12]],
    attack: 0.004,
    decay: 0.9,
    notes: [[B4, 0], [D5, 0.17]],
  },
  // Más luminosa, como campanillas de viento.
  campanillas: {
    partials: [[1, 1, 1], [2.76, 0.2, 0.5], [5.4, 0.08, 0.3]],
    attack: 0.01,
    decay: 1.6,
    notes: [[D5, 0], [G5, 0.2]],
  },
};

export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundVariant = "kalimba";

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
      master.gain.value = 0.55;
      master.connect(ctx.destination);

      // Suaviza cualquier brillo duro.
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 4200;
      tone.connect(master);

      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      const room = makeRoom(ctx);
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
      }, Math.ceil((last + voice.decay + 1.0) * 1000));
    };

    const p = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    void p.then(run).catch(run);
  } catch {
    /* ignore */
  }
}
