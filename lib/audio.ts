/**
 * Fleet Dice 3 — sound design.
 *
 * Every sound in this game is synthesised at runtime. There are no audio
 * assets, no CDN, nothing to download: one module, the Web Audio API, and a
 * handful of oscillators, noise buffers and filters. The whole sound pack
 * costs a few kilobytes of JavaScript.
 *
 * THE KEY IS D MINOR. Everything — cues, the ambient drone, the fanfare —
 * is built from D natural minor (D E F G A Bb C), tonic D. It is dark
 * without being grim, and it means two cues that fire at the same moment
 * (a straight landing while a volley launches) still agree with each other.
 * Victory takes the one liberty: it ends on a D major chord, the Picardy
 * third, because that is what winning is supposed to feel like.
 *
 * Design rules kept throughout:
 *   - No raw oscillator gates. Every voice has an attack, a body and a tail.
 *   - Repeated cues (dice, buttons) are randomised a few percent in pitch
 *     and level so eight in a row do not machine-gun.
 *   - One procedural reverb impulse, built once, shared by every cue.
 *   - Nothing is created before a user gesture, and nothing is left running
 *     afterwards: every oscillator has a stop time and disconnects itself.
 *
 * Usage:
 *   audio.unlock()                      // on the first pointerdown/keydown
 *   audio.play("dice-land", { size: 8 })
 *   audio.ambient.start(); audio.ambient.setIntensity(0.7)
 */

import type { DieSize } from "./engine";

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

export type CueName =
  // dice
  | "dice-throw"
  | "dice-land"
  | "dice-select"
  | "dice-deselect"
  | "reroll"
  // scoring
  | "straight"
  | "formation-row"
  | "formation-column"
  | "flagship-ring"
  // combat
  | "volley"
  | "impact-heavy"
  | "impact-light"
  | "shield-block"
  | "direct-hit"
  | "repair"
  | "ship-lost"
  // interface
  | "button"
  | "button-major"
  | "shop-buy"
  | "error"
  | "round-start"
  | "victory"
  | "defeat";

export type PlayOptions = {
  /** Frequency multiplier. 1 is the designed pitch; 1.06 is a semitone up. */
  pitch?: number;
  /** Hull size for `dice-land` — bigger die, deeper and longer thud. */
  size?: DieSize;
  /** Level trim for this one firing, 0..1.5. Default 1. */
  gain?: number;
  /** Seconds to wait before the cue starts. Default 0. */
  delay?: number;
  /** Stereo placement, -1 left to 1 right. Default centre. */
  pan?: number;
};

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

const STORE_MUTED = "fd3.audio.muted";
const STORE_VOLUME = "fd3.audio.volume";

/** Headroom below the limiter so a stacked round never clips. */
const OUTPUT_TRIM = 0.85;
/** Hard ceiling on simultaneous voices — a phone with a WebGL scene to run. */
const MAX_VOICES = 64;
/** exponentialRamp cannot touch zero. */
const FLOOR = 0.0001;

const AMBIENT_QUIET = 0.05;
const AMBIENT_LOUD = 0.15;

/* ------------------------------------------------------------------ *
 * Musical helpers — MIDI numbers so intervals stay readable.
 * D3 = 50, D4 = 62, A4 = 69, D5 = 74.
 * ------------------------------------------------------------------ */

function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** D natural minor, as semitone offsets from the tonic. */
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const TONIC = 62; // D4

/** Scale degree relative to D4. `deg(0)` is D4, `deg(7)` is D5, `deg(-1)` is C4. */
function deg(step: number): number {
  const octave = Math.floor(step / 7);
  const within = MINOR[((step % 7) + 7) % 7] ?? 0;
  return TONIC + octave * 12 + within;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A small multiplicative wobble around 1 — the anti-machine-gun trick. */
function wobble(cents: number): number {
  return Math.pow(2, rand(-cents, cents) / 1200);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/* ------------------------------------------------------------------ *
 * Preferences — readable before any audio exists, because the settings
 * panel renders long before the first gesture.
 * ------------------------------------------------------------------ */

type Prefs = { muted: boolean; volume: number };

let prefs: Prefs | null = null;

function readPrefs(): Prefs {
  if (prefs) return prefs;
  let muted = false;
  let volume = 0.75;
  try {
    if (typeof localStorage !== "undefined") {
      muted = localStorage.getItem(STORE_MUTED) === "1";
      const stored = Number.parseFloat(localStorage.getItem(STORE_VOLUME) ?? "");
      if (Number.isFinite(stored)) volume = clamp(stored, 0, 1);
    }
  } catch {
    // Private browsing throws on access. Defaults are fine.
  }
  prefs = { muted, volume };
  return prefs;
}

function writePrefs(): void {
  const p = readPrefs();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORE_MUTED, p.muted ? "1" : "0");
      localStorage.setItem(STORE_VOLUME, p.volume.toFixed(3));
    }
  } catch {
    // Not being able to remember the setting is not worth an exception.
  }
}

let reducedMotion = false;

function watchReducedMotion(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion = query.matches;
  query.addEventListener("change", (event) => {
    reducedMotion = event.matches;
  });
}

/** Cues that punch, crunch or cut get held back when motion is reduced. */
const JARRING: ReadonlySet<CueName> = new Set<CueName>([
  "impact-heavy",
  "impact-light",
  "direct-hit",
  "ship-lost",
  "volley",
]);

/* ------------------------------------------------------------------ *
 * The engine: master chain, shared buffers, shared reverb.
 * ------------------------------------------------------------------ */

type Engine = {
  ctx: AudioContext;
  /** Master volume and mute live here, last stop before the limiter. */
  master: GainNode;
  /** Everything sums into this. */
  mix: GainNode;
  /** Dry cue bus. */
  sfx: GainNode;
  /** Ambient bed bus — its own level so intensity can ride independently. */
  bed: GainNode;
  /** Reverb send. Cues tap it at whatever depth they want. */
  send: GainNode;
  /** Shared saturation path for impacts and crunches. */
  crunch: GainNode;
  noise: AudioBuffer;
  voices: number;
};

let engine: Engine | null = null;
let unlocked = false;
let gestureHooked = false;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  // Older Safari only has the prefixed constructor, which the DOM lib does
  // not know about, hence the widened view of the global scope.
  const scope = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * White noise, three seconds of it, generated once. Every hiss, click,
 * chuff and whoosh in the game reads a random slice of this one buffer.
 */
function buildNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 3);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    // A gentle one-pole tilt: pure white is brittle, this sits better.
    last = white * 0.82 + last * 0.18;
    data[i] = last;
  }
  return buffer;
}

/**
 * A procedural impulse response: decaying stereo noise, darkened by a
 * one-pole lowpass that closes as the tail decays, plus a short gap at the
 * front so it reads as a room rather than a smear on the transient.
 * Two seconds, built once, shared by every cue that wants space.
 */
function buildImpulse(ctx: AudioContext): AudioBuffer {
  const seconds = 2;
  const length = Math.floor(ctx.sampleRate * seconds);
  const preDelay = Math.floor(ctx.sampleRate * 0.012);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i += 1) {
      if (i < preDelay) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelay) / (length - preDelay);
      const decay = Math.pow(1 - t, 2.6);
      // Damping increases with time: highs die before lows, like a real room.
      const damp = 0.28 + t * 0.5;
      smooth = (Math.random() * 2 - 1) * (1 - damp) + smooth * damp;
      // A couple of early reflections keep it from sounding like a cloud.
      const early = i === Math.floor(preDelay * 2.4) || i === Math.floor(preDelay * 5.1) ? 3 : 1;
      data[i] = smooth * decay * early;
    }
  }
  return impulse;
}

/** A soft tanh-ish saturation curve. One array, shared by every shaper. */
function buildCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.4) * 0.86;
  }
  return curve;
}

function masterLevel(): number {
  const p = readPrefs();
  if (p.muted) return 0;
  // A perceptual taper: linear volume sliders feel top-heavy.
  return Math.pow(p.volume, 1.7) * OUTPUT_TRIM;
}

function createEngine(): Engine | null {
  const Ctor = contextCtor();
  if (!Ctor) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = masterLevel();

  // A safety limiter, not a effect: it only works when a round gets busy.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  const mix = ctx.createGain();
  mix.gain.value = 1;

  const sfx = ctx.createGain();
  sfx.gain.value = 1;

  const bed = ctx.createGain();
  bed.gain.value = 0;

  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulse(ctx);

  const send = ctx.createGain();
  send.gain.value = 1;

  const wet = ctx.createGain();
  wet.gain.value = 0.9;

  // Keep the reverb out of the sub: low end in a tail is just mud.
  const wetCut = ctx.createBiquadFilter();
  wetCut.type = "highpass";
  wetCut.frequency.value = 260;

  const shaper = ctx.createWaveShaper();
  shaper.curve = buildCurve();
  shaper.oversample = "2x";

  const crunch = ctx.createGain();
  crunch.gain.value = 1;
  const crunchTone = ctx.createBiquadFilter();
  crunchTone.type = "lowpass";
  crunchTone.frequency.value = 2400;
  crunchTone.Q.value = 0.5;
  const crunchOut = ctx.createGain();
  crunchOut.gain.value = 0.7;

  crunch.connect(shaper);
  shaper.connect(crunchTone);
  crunchTone.connect(crunchOut);
  crunchOut.connect(mix);

  send.connect(wetCut);
  wetCut.connect(convolver);
  convolver.connect(wet);
  wet.connect(mix);

  sfx.connect(mix);
  bed.connect(mix);
  mix.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);

  return { ctx, master, mix, sfx, bed, send, crunch, noise: buildNoise(ctx), voices: 0 };
}

/** The engine if it exists and is allowed to make sound, otherwise null. */
function live(): Engine | null {
  if (!unlocked || !engine) return null;
  if (engine.ctx.state === "closed") return null;
  return engine;
}

function hookGesture(): void {
  if (gestureHooked || typeof window === "undefined") return;
  gestureHooked = true;
  const events: ReadonlyArray<keyof WindowEventMap> = ["pointerdown", "touchend", "keydown"];
  const onGesture = (): void => {
    for (const name of events) window.removeEventListener(name, onGesture);
    unlock();
  };
  for (const name of events) window.addEventListener(name, onGesture, { passive: true });
}

function hookVisibility(ctx: AudioContext): void {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void ctx.suspend().catch(() => undefined);
    } else if (unlocked) {
      void ctx.resume().catch(() => undefined);
    }
  });
}

/**
 * Create the context and get it running. Safe to call on every gesture and
 * safe to call too early: if the browser refuses, we quietly wait for the
 * next real interaction and try again.
 */
function unlock(): void {
  if (typeof window === "undefined") return;
  if (!engine) {
    watchReducedMotion();
    engine = createEngine();
    if (!engine) return;
    hookVisibility(engine.ctx);
  }
  const ctx = engine.ctx;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  if (ctx.state === "running") {
    unlocked = true;
    engine.master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.01);
  } else {
    // Not a real gesture yet. Listen for one and finish the job then.
    hookGesture();
  }
}

/* ------------------------------------------------------------------ *
 * Voice plumbing — small helpers every cue is built from.
 * Each one owns its nodes, schedules its own stop, and disconnects
 * itself when the source ends. Nothing is left running.
 * ------------------------------------------------------------------ */

function claim(e: Engine): boolean {
  if (e.voices >= MAX_VOICES) return false;
  e.voices += 1;
  return true;
}

/** Start the sources, and hand the whole graph back to the collector at `end`. */
function runVoice(
  e: Engine,
  sources: AudioScheduledSourceNode[],
  nodes: AudioNode[],
  at: number,
  end: number,
): void {
  const first = sources[0];
  if (!first) {
    e.voices -= 1;
    return;
  }
  for (const source of sources) {
    source.start(at);
    source.stop(end);
  }
  first.onended = () => {
    for (const source of sources) source.disconnect();
    for (const node of nodes) node.disconnect();
    first.onended = null;
    e.voices -= 1;
  };
}

/**
 * The universal envelope: silence, attack to peak, optional hold, tail to
 * silence. Exponential throughout, which is what an ear expects.
 */
function envelope(
  param: AudioParam,
  at: number,
  peak: number,
  attack: number,
  hold: number,
  decay: number,
): number {
  const top = Math.max(peak, FLOOR * 2);
  const a = Math.max(attack, 0.001);
  const d = Math.max(decay, 0.01);
  param.cancelScheduledValues(at);
  param.setValueAtTime(FLOOR, at);
  param.exponentialRampToValueAtTime(top, at + a);
  if (hold > 0) param.setValueAtTime(top, at + a + hold);
  param.exponentialRampToValueAtTime(FLOOR, at + a + hold + d);
  return at + a + hold + d;
}

type FilterSpec = {
  type: BiquadFilterType;
  freq: number;
  /** Sweep the cutoff here across the life of the voice. */
  toFreq?: number;
  q?: number;
};

type ToneOptions = {
  at: number;
  freq: number;
  /** Glide the pitch here — the backbone of thumps, whines and doppler tails. */
  toFreq?: number;
  /** Glide time. Defaults to the whole envelope. */
  glide?: number;
  type?: OscillatorType;
  detune?: number;
  peak?: number;
  attack?: number;
  hold?: number;
  decay?: number;
  filter?: FilterSpec;
  /** Reverb depth, 0..1. */
  send?: number;
  pan?: number;
  dest?: AudioNode;
};

/** One pitched voice: oscillator, optional filter, envelope, optional space. */
function tone(e: Engine, o: ToneOptions): number {
  const attack = o.attack ?? 0.004;
  const hold = o.hold ?? 0;
  const decay = o.decay ?? 0.2;
  const end = o.at + Math.max(attack, 0.001) + hold + Math.max(decay, 0.01);
  if (!claim(e)) return end;

  const ctx = e.ctx;
  const nodes: AudioNode[] = [];
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(Math.max(8, o.freq), o.at);
  if (o.toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(8, o.toFreq),
      o.at + Math.max(0.01, o.glide ?? end - o.at),
    );
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, o.at);

  let node: AudioNode = osc;
  if (o.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter.type;
    filter.frequency.setValueAtTime(Math.max(20, o.filter.freq), o.at);
    if (o.filter.toFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.toFreq), end);
    }
    if (o.filter.q !== undefined) filter.Q.value = o.filter.q;
    node.connect(filter);
    nodes.push(filter);
    node = filter;
  }

  const gain = ctx.createGain();
  envelope(gain.gain, o.at, o.peak ?? 0.2, attack, hold, decay);
  node.connect(gain);
  nodes.push(gain);

  let out: AudioNode = gain;
  if (o.pan !== undefined && typeof ctx.createStereoPanner === "function") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(o.pan, -1, 1);
    gain.connect(panner);
    nodes.push(panner);
    out = panner;
  }
  out.connect(o.dest ?? e.sfx);
  if (o.send) {
    const tap = ctx.createGain();
    tap.gain.value = o.send;
    out.connect(tap);
    tap.connect(e.send);
    nodes.push(tap);
  }

  runVoice(e, [osc], nodes, o.at, end + 0.02);
  return end;
}

type NoiseOptions = {
  at: number;
  peak?: number;
  attack?: number;
  hold?: number;
  decay?: number;
  filter?: FilterSpec;
  /** Reads the shared buffer faster or slower — cheap timbre control. */
  rate?: number;
  send?: number;
  pan?: number;
  dest?: AudioNode;
};

/** One shaped slice of the shared noise buffer: air, clicks, chuffs, whooshes. */
function noise(e: Engine, o: NoiseOptions): number {
  const attack = o.attack ?? 0.002;
  const hold = o.hold ?? 0;
  const decay = o.decay ?? 0.12;
  const end = o.at + Math.max(attack, 0.001) + hold + Math.max(decay, 0.01);
  if (!claim(e)) return end;

  const ctx = e.ctx;
  const nodes: AudioNode[] = [];
  const source = ctx.createBufferSource();
  source.buffer = e.noise;
  source.playbackRate.value = o.rate ?? 1;

  let node: AudioNode = source;
  if (o.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter.type;
    filter.frequency.setValueAtTime(Math.max(20, o.filter.freq), o.at);
    if (o.filter.toFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.toFreq), end);
    }
    if (o.filter.q !== undefined) filter.Q.value = o.filter.q;
    node.connect(filter);
    nodes.push(filter);
    node = filter;
  }

  const gain = ctx.createGain();
  envelope(gain.gain, o.at, o.peak ?? 0.2, attack, hold, decay);
  node.connect(gain);
  nodes.push(gain);

  let out: AudioNode = gain;
  if (o.pan !== undefined && typeof ctx.createStereoPanner === "function") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(o.pan, -1, 1);
    gain.connect(panner);
    nodes.push(panner);
    out = panner;
  }
  out.connect(o.dest ?? e.sfx);
  if (o.send) {
    const tap = ctx.createGain();
    tap.gain.value = o.send;
    out.connect(tap);
    tap.connect(e.send);
    nodes.push(tap);
  }

  // Read from a random point so repeated clicks never share a waveform.
  const span = Math.max(0.05, e.noise.duration - (end - o.at) - 0.05);
  source.start(o.at, Math.random() * span);
  source.stop(end + 0.02);
  source.onended = () => {
    source.disconnect();
    for (const n of nodes) n.disconnect();
    source.onended = null;
    e.voices -= 1;
  };
  return end;
}

type BellOptions = {
  at: number;
  /** Partial frequencies, loudest first. */
  freqs: number[];
  peak?: number;
  attack?: number;
  decay?: number;
  /** Higher partials die sooner by this factor per partial. */
  damping?: number;
  send?: number;
  pan?: number;
  type?: OscillatorType;
};

/** Struck metal and glass: decaying partials, each slightly out of tune. */
function bell(e: Engine, o: BellOptions): number {
  const peak = o.peak ?? 0.14;
  const attack = o.attack ?? 0.006;
  const decay = o.decay ?? 0.9;
  const damping = o.damping ?? 0.62;
  let end = o.at;
  o.freqs.forEach((freq, index) => {
    const level = peak * Math.pow(0.66, index);
    const life = decay * Math.pow(damping, index);
    end = Math.max(
      end,
      tone(e, {
        at: o.at,
        freq: freq * wobble(6),
        type: o.type ?? "sine",
        detune: rand(-7, 7),
        peak: level,
        attack: attack + index * 0.002,
        decay: life,
        send: o.send,
        pan: o.pan,
      }),
    );
  });
  return end;
}

/* ------------------------------------------------------------------ *
 * The cues.
 * ------------------------------------------------------------------ */

/** How deep and how long a hull rings when it hits the table. */
const HULL: Record<DieSize, { midi: number; decay: number; body: number; click: number }> = {
  4: { midi: 74, decay: 0.1, body: 0.1, click: 0.2 }, // D5 — a sharp tap
  6: { midi: 69, decay: 0.15, body: 0.15, click: 0.16 }, // A4
  8: { midi: 62, decay: 0.24, body: 0.2, click: 0.13 }, // D4
  10: { midi: 50, decay: 0.4, body: 0.26, click: 0.1 }, // D3 — a heavy knock
};

type Cue = (e: Engine, at: number, o: PlayOptions, level: number) => void;

const CUES: Record<CueName, Cue> = {
  /**
   * DICE-THROW — the release.
   * Air leaving the hand: a bandpass whoosh that opens upward, three or four
   * dry rattles as the dice knock together in flight, and a quiet sine that
   * rises a fourth underneath so the gesture has direction.
   */
  "dice-throw": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    noise(e, {
      at,
      peak: 0.16 * level,
      attack: 0.05,
      decay: 0.22,
      rate: rand(0.9, 1.15),
      filter: { type: "bandpass", freq: 420 * pitch, toFreq: 2400 * pitch, q: 0.9 },
      send: 0.12,
      pan: o.pan ?? rand(-0.2, 0.2),
    });
    const rattles = 3 + Math.floor(rand(0, 2));
    for (let i = 0; i < rattles; i += 1) {
      noise(e, {
        at: at + rand(0.01, 0.16),
        peak: 0.07 * level,
        attack: 0.001,
        decay: 0.02,
        filter: { type: "bandpass", freq: rand(1500, 3200), q: 3.5 },
        pan: rand(-0.5, 0.5),
      });
    }
    tone(e, {
      at,
      freq: hz(deg(-3)) * pitch, // A3
      toFreq: hz(deg(0)) * pitch, // up to D4
      type: "triangle",
      peak: 0.05 * level,
      attack: 0.04,
      decay: 0.2,
    });
  },

  /**
   * DICE-LAND — the hit, and the one cue that must scale.
   * Three layers: a click transient (the corner touching down), a pitched
   * body that drops an octave in 50 ms (the mass), and a short resonant
   * ring (the hollow inside). A d4 is nearly all click; a d10 is nearly all
   * body and ring. Pitch wobbles a semitone either way every time.
   */
  "dice-land": (e, at, o, level) => {
    const hull = HULL[o.size ?? 6];
    const pitch = (o.pitch ?? 1) * wobble(70);
    const root = hz(hull.midi) * pitch;
    const vary = rand(0.85, 1.12);

    noise(e, {
      at,
      peak: hull.click * level * vary,
      attack: 0.0008,
      decay: 0.018 + hull.decay * 0.06,
      filter: { type: "highpass", freq: 1600, q: 0.7 },
      pan: o.pan,
    });
    tone(e, {
      at,
      freq: root * 2,
      toFreq: root,
      glide: 0.05,
      type: "sine",
      peak: hull.body * level * vary,
      attack: 0.001,
      decay: hull.decay,
      pan: o.pan,
    });
    tone(e, {
      at: at + 0.004,
      freq: root * 2.42, // an inharmonic partial: hollow, not musical
      type: "triangle",
      peak: hull.body * 0.35 * level,
      attack: 0.002,
      decay: hull.decay * 1.4,
      filter: { type: "lowpass", freq: 4200, q: 0.6 },
      send: 0.1,
      pan: o.pan,
    });
  },

  /**
   * DICE-SELECT — picking a die up.
   * The smallest possible sound that still registers: one sine pip on the
   * fifth, four milliseconds of attack, gone in eighty. Fires dozens of
   * times a round, so it lives at a level you notice only when it stops.
   */
  "dice-select": (e, at, o, level) => {
    const pitch = (o.pitch ?? 1) * wobble(35);
    tone(e, {
      at,
      freq: hz(deg(11)) * pitch, // A5
      type: "sine",
      peak: 0.07 * level,
      attack: 0.003,
      decay: 0.07,
      pan: o.pan,
    });
    noise(e, {
      at,
      peak: 0.03 * level,
      attack: 0.0005,
      decay: 0.012,
      filter: { type: "bandpass", freq: 4200, q: 2 },
      pan: o.pan,
    });
  },

  /**
   * DICE-DESELECT — putting it back.
   * The same pip, a third lower and a shade quieter, sliding down instead of
   * sitting still. Reads as "undone" without being a separate idea.
   */
  "dice-deselect": (e, at, o, level) => {
    const pitch = (o.pitch ?? 1) * wobble(35);
    tone(e, {
      at,
      freq: hz(deg(9)) * pitch, // F5
      toFreq: hz(deg(7)) * pitch, // down to D5
      glide: 0.05,
      type: "sine",
      peak: 0.05 * level,
      attack: 0.003,
      decay: 0.06,
      pan: o.pan,
    });
  },

  /**
   * REROLL — sending dice back.
   * A whoosh that swells and cuts rather than fading: filtered noise rising
   * through the mids, a low sine falling away underneath as the dice leave,
   * and a scatter of rattles in the tail as they land in the cup.
   */
  reroll: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    noise(e, {
      at,
      peak: 0.2 * level,
      attack: 0.13,
      decay: 0.13,
      rate: rand(0.85, 1.1),
      filter: { type: "bandpass", freq: 500 * pitch, toFreq: 2600 * pitch, q: 1.1 },
      send: 0.16,
      pan: o.pan,
    });
    tone(e, {
      at,
      freq: hz(deg(0)) * pitch,
      toFreq: hz(deg(-7)) * pitch, // an octave down
      type: "sine",
      peak: 0.1 * level,
      attack: 0.02,
      decay: 0.28,
    });
    for (let i = 0; i < 5; i += 1) {
      noise(e, {
        at: at + 0.2 + rand(0, 0.18),
        peak: 0.05 * level,
        attack: 0.001,
        decay: 0.025,
        filter: { type: "bandpass", freq: rand(1200, 3000), q: 4 },
        pan: rand(-0.6, 0.6),
      });
    }
  },

  /**
   * STRAIGHT — the big one.
   * Five or more in a row, so the sound is literally a run: six notes up the
   * D minor scale, 85 ms apart, each a bright two-oscillator pluck with an
   * octave sparkle on top, then the top D and A held together and left to
   * ring. It rises, it completes, it glows. About a second.
   */
  straight: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    const run = [0, 1, 2, 4, 5, 7]; // D E F A Bb D — the tonic reached from below
    run.forEach((step, index) => {
      const start = at + index * 0.085 + rand(-0.006, 0.006);
      const freq = hz(deg(step)) * pitch;
      tone(e, {
        at: start,
        freq,
        type: "triangle",
        peak: (0.13 + index * 0.012) * level,
        attack: 0.006,
        decay: 0.34,
        filter: { type: "lowpass", freq: 5200, q: 0.7 },
        send: 0.28,
      });
      tone(e, {
        at: start,
        freq: freq * 2,
        type: "sine",
        detune: rand(-5, 5),
        peak: 0.05 * level,
        attack: 0.004,
        decay: 0.18,
        send: 0.3,
      });
    });
    const chord = at + run.length * 0.085;
    for (const step of [7, 11, 14]) {
      tone(e, {
        at: chord,
        freq: hz(deg(step)) * pitch,
        type: "triangle",
        detune: rand(-6, 6),
        peak: 0.11 * level,
        attack: 0.012,
        hold: 0.06,
        decay: 0.75,
        filter: { type: "lowpass", freq: 6000, q: 0.6 },
        send: 0.4,
      });
    }
    tone(e, {
      at: chord,
      freq: hz(deg(-7)) * pitch, // the root underneath, felt not heard
      type: "sine",
      peak: 0.12 * level,
      attack: 0.02,
      decay: 0.7,
    });
  },

  /**
   * FORMATION-ROW — three across, pays Energy.
   * Yellow and electrical: a sawtooth charging up through a lowpass that
   * opens from 200 Hz to 3 kHz while the pitch creeps up a whole tone, with
   * a fast tremolo buzz riding on it. It lands on a warm F-and-A dyad —
   * the relative major sitting inside D minor, which is where "yellow"
   * lives in this key.
   */
  "formation-row": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    tone(e, {
      at,
      freq: hz(deg(2)) * pitch, // F4, charging
      toFreq: hz(deg(3)) * pitch, // creeping up to G4
      glide: 0.34,
      type: "sawtooth",
      peak: 0.11 * level,
      attack: 0.1,
      decay: 0.24,
      filter: { type: "lowpass", freq: 220, toFreq: 3000, q: 3.5 },
    });
    // The buzz: a second saw a hair out of tune beats against the first.
    tone(e, {
      at,
      freq: hz(deg(2)) * pitch,
      type: "sawtooth",
      detune: 14,
      peak: 0.05 * level,
      attack: 0.12,
      decay: 0.22,
      filter: { type: "bandpass", freq: 1400, q: 1.4 },
    });
    const settle = at + 0.34;
    for (const step of [9, 11]) {
      // F5 and A5 — warm, open, paid out
      tone(e, {
        at: settle,
        freq: hz(deg(step)) * pitch,
        type: "triangle",
        detune: rand(-5, 5),
        peak: 0.12 * level,
        attack: 0.008,
        decay: 0.42,
        send: 0.22,
      });
    }
    noise(e, {
      at: settle,
      peak: 0.05 * level,
      attack: 0.001,
      decay: 0.05,
      filter: { type: "highpass", freq: 3000 },
    });
  },

  /**
   * FORMATION-COLUMN — three down, pays Attack.
   * Harder, mechanical, a lock-on: two clipped square beeps a fifth apart
   * through a narrow bandpass, then the mechanism seating itself — a low saw
   * dropping a fifth with a chuff of air. Same key, opposite character to
   * the row.
   */
  "formation-column": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    for (let i = 0; i < 2; i += 1) {
      tone(e, {
        at: at + i * 0.095,
        freq: hz(deg(i === 0 ? 7 : 11)) * pitch, // D5 then A5
        type: "square",
        peak: 0.075 * level,
        attack: 0.002,
        hold: 0.02,
        decay: 0.05,
        filter: { type: "bandpass", freq: 2000, q: 2.2 },
      });
    }
    const lock = at + 0.21;
    tone(e, {
      at: lock,
      freq: hz(deg(0)) * pitch,
      toFreq: hz(deg(-4)) * pitch, // down a fifth: the bolt seating
      glide: 0.1,
      type: "sawtooth",
      peak: 0.16 * level,
      attack: 0.003,
      decay: 0.2,
      filter: { type: "lowpass", freq: 1600, toFreq: 700, q: 2 },
      dest: e.crunch,
    });
    noise(e, {
      at: lock,
      peak: 0.09 * level,
      attack: 0.001,
      decay: 0.07,
      filter: { type: "bandpass", freq: 900, q: 1.2 },
      send: 0.1,
    });
  },

  /**
   * FLAGSHIP-RING — the flagship's face lighting up matching ships.
   * Golden shimmer, no transient worth speaking of: bell partials on D, A
   * and the octave with a 60 ms swell, a long tail, and a breath of high
   * filtered air over the top. Heavily reverbed, deliberately quiet — it is
   * light, not an event.
   */
  "flagship-ring": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    bell(e, {
      at,
      freqs: [hz(deg(7)) * pitch, hz(deg(11)) * pitch, hz(deg(14)) * pitch, hz(deg(16)) * pitch],
      peak: 0.09 * level,
      attack: 0.06,
      decay: 1.3,
      damping: 0.74,
      send: 0.55,
      pan: o.pan,
    });
    noise(e, {
      at,
      peak: 0.035 * level,
      attack: 0.14,
      decay: 0.6,
      rate: 1.3,
      filter: { type: "bandpass", freq: 5200, toFreq: 7000, q: 1.6 },
      send: 0.5,
    });
  },

  /**
   * VOLLEY — your attack firing.
   * Three beats in one gesture: a low thump as the tube fires, a whine that
   * rises a fifth while its bandpass climbs (the round accelerating), and
   * the release — a noise burst that dopplers away downward.
   */
  volley: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    tone(e, {
      at,
      freq: hz(deg(-7)) * pitch,
      toFreq: hz(deg(-14)) * pitch,
      glide: 0.12,
      type: "sine",
      peak: 0.26 * level,
      attack: 0.002,
      decay: 0.18,
    });
    tone(e, {
      at: at + 0.02,
      freq: hz(deg(-3)) * pitch,
      toFreq: hz(deg(4)) * pitch,
      glide: 0.26,
      type: "sawtooth",
      peak: 0.1 * level,
      attack: 0.06,
      decay: 0.16,
      filter: { type: "bandpass", freq: 300, toFreq: 1800, q: 3 },
      send: 0.12,
    });
    noise(e, {
      at: at + 0.24,
      peak: 0.14 * level,
      attack: 0.004,
      decay: 0.34,
      rate: 1.15,
      filter: { type: "bandpass", freq: 2600, toFreq: 500, q: 1 },
      send: 0.25,
      pan: o.pan ?? rand(-0.15, 0.15),
    });
  },

  /**
   * IMPACT-HEAVY — damage landing on your flagship.
   * The one you feel in your chest: a sub dropping from 120 Hz to nearly
   * nothing over 400 ms, a saturated mid layer through the shared crunch
   * path, a crack of high noise on the front, and a low ring left shaking.
   */
  "impact-heavy": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    tone(e, {
      at,
      freq: 120 * pitch,
      toFreq: 38 * pitch,
      glide: 0.3,
      type: "sine",
      peak: 0.4 * level,
      attack: 0.002,
      decay: 0.42,
    });
    tone(e, {
      at,
      freq: hz(deg(-14)) * pitch, // D2 collapsing to D1
      toFreq: hz(deg(-21)) * pitch,
      glide: 0.14,
      type: "sawtooth",
      peak: 0.5 * level,
      attack: 0.003,
      decay: 0.2,
      filter: { type: "lowpass", freq: 900, toFreq: 300, q: 1.4 },
      dest: e.crunch,
    });
    noise(e, {
      at,
      peak: 0.22 * level,
      attack: 0.001,
      decay: 0.09,
      filter: { type: "highpass", freq: 1400 },
      send: 0.2,
    });
    noise(e, {
      at: at + 0.03,
      peak: 0.1 * level,
      attack: 0.01,
      decay: 0.5,
      rate: 0.7,
      filter: { type: "lowpass", freq: 500, q: 1.2 },
      send: 0.25,
    });
  },

  /**
   * IMPACT-LIGHT — the same hit, smaller.
   * Same recipe, less of everything: the sub does not go as deep, the
   * saturation is barely on, and it is over in a quarter of a second so a
   * string of small hits does not turn into mud.
   */
  "impact-light": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    tone(e, {
      at,
      freq: 105 * pitch,
      toFreq: 55 * pitch,
      glide: 0.16,
      type: "sine",
      peak: 0.25 * level,
      attack: 0.002,
      decay: 0.22,
    });
    tone(e, {
      at,
      freq: hz(deg(-10)) * pitch,
      toFreq: hz(deg(-12)) * pitch,
      glide: 0.09,
      type: "sawtooth",
      peak: 0.24 * level,
      attack: 0.002,
      decay: 0.11,
      filter: { type: "lowpass", freq: 1200, toFreq: 500, q: 1.2 },
      dest: e.crunch,
    });
    noise(e, {
      at,
      peak: 0.14 * level,
      attack: 0.001,
      decay: 0.06,
      filter: { type: "highpass", freq: 1800 },
      send: 0.15,
    });
  },

  /**
   * SHIELD-BLOCK — damage absorbed.
   * Metal doing its job: a hard chink of high noise exciting three
   * inharmonic partials (1 : 2.4 : 4.6, the ratios that read as struck
   * steel rather than a musical bell), left to ring out for the better part
   * of a second. Rolled off above 8 kHz so it is bright, never shrill.
   */
  "shield-block": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    const root = hz(deg(4)) * pitch * wobble(45); // A4-ish
    noise(e, {
      at,
      peak: 0.16 * level,
      attack: 0.0008,
      decay: 0.03,
      filter: { type: "bandpass", freq: 3400, q: 1.4 },
      pan: o.pan,
    });
    bell(e, {
      at,
      freqs: [root, root * 2.42, root * 4.61],
      peak: 0.15 * level,
      attack: 0.003,
      decay: 0.85,
      damping: 0.55,
      type: "sine",
      send: 0.35,
      pan: o.pan,
    });
    tone(e, {
      at,
      freq: root * 0.5,
      type: "sine",
      peak: 0.1 * level,
      attack: 0.004,
      decay: 0.3,
      filter: { type: "lowpass", freq: 8000 },
    });
  },

  /**
   * DIRECT-HIT — unblockable damage.
   * This one is supposed to sound wrong. It is the only cue built on ring
   * modulation: a carrier on D multiplied by a modulator a tritone away,
   * which produces sum and difference tones that belong to no key at all.
   * Cutting, violet, metallic in a way nothing else here is — you hear it
   * and know it was not a normal hit. Short, so it never becomes unpleasant.
   */
  "direct-hit": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    const end = at + 0.46;
    if (!claim(e)) return;
    const ctx = e.ctx;

    const carrier = ctx.createOscillator();
    carrier.type = "sawtooth";
    carrier.frequency.setValueAtTime(hz(deg(14)) * pitch, at);
    carrier.frequency.exponentialRampToValueAtTime(hz(deg(7)) * pitch, end);

    const modulator = ctx.createOscillator();
    modulator.type = "sine";
    // A tritone above the carrier's root: the interval the ear refuses to file.
    modulator.frequency.setValueAtTime(hz(deg(7) + 6) * pitch, at);
    modulator.frequency.exponentialRampToValueAtTime(hz(deg(7) + 6) * pitch * 0.7, end);

    const ring = ctx.createGain();
    ring.gain.value = 0; // modulated entirely by the modulator
    modulator.connect(ring.gain);
    carrier.connect(ring);

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(2600, at);
    band.frequency.exponentialRampToValueAtTime(1200, end);
    band.Q.value = 1.8;

    const out = ctx.createGain();
    envelope(out.gain, at, 0.3 * level, 0.03, 0.02, 0.3);

    const tap = ctx.createGain();
    tap.gain.value = 0.3;

    ring.connect(band);
    band.connect(out);
    out.connect(e.sfx);
    out.connect(tap);
    tap.connect(e.send);

    runVoice(e, [carrier, modulator], [ring, band, out, tap], at, end + 0.05);

    // A slash of air across the front so it cuts through whatever else plays.
    noise(e, {
      at,
      peak: 0.16 * level,
      attack: 0.002,
      decay: 0.14,
      rate: 1.4,
      filter: { type: "highpass", freq: 2600 },
      send: 0.2,
      pan: o.pan,
    });
  },

  /**
   * REPAIR — health coming back.
   * Three soft sine notes up a D minor triad with slow attacks, plus a
   * breath of air rising behind them. Warm, brief, no sparkle: this is
   * relief, not celebration.
   */
  repair: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    [0, 2, 4].forEach((step, index) => {
      tone(e, {
        at: at + index * 0.075,
        freq: hz(deg(step + 7)) * pitch,
        type: "sine",
        detune: rand(-4, 4),
        peak: 0.13 * level,
        attack: 0.03,
        decay: 0.34,
        send: 0.25,
      });
    });
    noise(e, {
      at,
      peak: 0.05 * level,
      attack: 0.16,
      decay: 0.2,
      filter: { type: "bandpass", freq: 700, toFreq: 2400, q: 1.2 },
      send: 0.2,
    });
  },

  /**
   * SHIP-LOST — a ship thrown in front of the volley.
   * A crunch and then nothing: saturated noise collapsing through a closing
   * lowpass, a snapped mid layer, and a low D left slipping slightly flat as
   * it fades. Short. The board will say the rest.
   */
  "ship-lost": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    noise(e, {
      at,
      peak: 0.3 * level,
      attack: 0.002,
      decay: 0.22,
      rate: 0.85,
      filter: { type: "lowpass", freq: 2400, toFreq: 260, q: 1.6 },
      dest: e.crunch,
    });
    tone(e, {
      at,
      freq: hz(deg(-7)) * pitch,
      toFreq: hz(deg(-11)) * pitch,
      glide: 0.18,
      type: "sawtooth",
      peak: 0.22 * level,
      attack: 0.003,
      decay: 0.16,
      filter: { type: "lowpass", freq: 1100, toFreq: 400, q: 1.2 },
      dest: e.crunch,
    });
    tone(e, {
      at: at + 0.05,
      freq: hz(deg(-14)) * pitch,
      toFreq: hz(deg(-14)) * pitch * 0.977, // a touch flat as it dies
      glide: 0.9,
      type: "sine",
      peak: 0.16 * level,
      attack: 0.02,
      decay: 0.85,
      send: 0.3,
    });
  },

  /**
   * BUTTON — the click you press a hundred times.
   * Six milliseconds of bandpassed noise and a sine pip too short to have a
   * pitch you could name. Firm, dry, quiet. The whole thing is under 60 ms
   * because anything longer becomes a texture, and textures get annoying.
   */
  button: (e, at, o, level) => {
    const pitch = (o.pitch ?? 1) * wobble(30);
    noise(e, {
      at,
      peak: 0.09 * level,
      attack: 0.0006,
      decay: 0.014,
      filter: { type: "bandpass", freq: 1900 * pitch, q: 1.6 },
      pan: o.pan,
    });
    tone(e, {
      at,
      freq: hz(deg(7)) * pitch,
      type: "sine",
      peak: 0.05 * level,
      attack: 0.002,
      decay: 0.035,
      pan: o.pan,
    });
  },

  /**
   * BUTTON-MAJOR — the primary action.
   * The same click with a body under it: a D-and-A dyad an octave down,
   * a longer tail and a little room. Authority, not volume.
   */
  "button-major": (e, at, o, level) => {
    const pitch = (o.pitch ?? 1) * wobble(20);
    noise(e, {
      at,
      peak: 0.1 * level,
      attack: 0.0008,
      decay: 0.02,
      filter: { type: "bandpass", freq: 1500 * pitch, q: 1.2 },
    });
    for (const step of [0, 4]) {
      tone(e, {
        at,
        freq: hz(deg(step)) * pitch,
        type: "triangle",
        detune: rand(-4, 4),
        peak: 0.11 * level,
        attack: 0.004,
        decay: 0.13,
        filter: { type: "lowpass", freq: 3200, q: 0.7 },
        send: 0.15,
      });
    }
    tone(e, {
      at,
      freq: hz(deg(-7)) * pitch,
      type: "sine",
      peak: 0.09 * level,
      attack: 0.004,
      decay: 0.12,
    });
  },

  /**
   * SHOP-BUY — a purchase confirming.
   * Value received: a fourth upward from A to D — the interval that sounds
   * like arriving — with a bell partial on top and two small high pips
   * behind it, the sound of something being counted out and handed over.
   */
  "shop-buy": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    tone(e, {
      at,
      freq: hz(deg(4)) * pitch, // A4
      type: "triangle",
      peak: 0.12 * level,
      attack: 0.005,
      decay: 0.16,
      send: 0.2,
    });
    bell(e, {
      at: at + 0.1,
      freqs: [hz(deg(7)) * pitch, hz(deg(14)) * pitch, hz(deg(18)) * pitch],
      peak: 0.13 * level,
      attack: 0.005,
      decay: 0.7,
      damping: 0.6,
      send: 0.35,
    });
    for (let i = 0; i < 2; i += 1) {
      tone(e, {
        at: at + 0.12 + i * 0.06,
        freq: hz(deg(18 + i * 2)) * pitch * wobble(20),
        type: "sine",
        peak: 0.045 * level,
        attack: 0.002,
        decay: 0.09,
        send: 0.3,
      });
    }
  },

  /**
   * ERROR — cannot afford, not allowed.
   * Two low tones a semitone apart sounded together: D and Eb, the Phrygian
   * clash, which the ear reads as "no" without any brightness at all. A
   * 12 ms attack so it never clicks, a lowpass at 700 Hz so it can never be
   * harsh, and gone in a fifth of a second.
   */
  error: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    for (const semitone of [0, 1]) {
      tone(e, {
        at,
        freq: hz(deg(-7) + semitone) * pitch,
        type: "triangle",
        peak: 0.13 * level,
        attack: 0.012,
        hold: 0.03,
        decay: 0.16,
        filter: { type: "lowpass", freq: 700, q: 0.8 },
      });
    }
  },

  /**
   * ROUND-START — a new round beginning.
   * A system coming online rather than a fanfare: a low D swelling up
   * through an opening filter, a rush of air behind it, and one clear bell
   * on the tonic to mark the moment. Under a second, and it leaves room for
   * whatever the players do next.
   */
  "round-start": (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    tone(e, {
      at,
      freq: hz(deg(-14)) * pitch,
      type: "sawtooth",
      peak: 0.14 * level,
      attack: 0.22,
      hold: 0.05,
      decay: 0.4,
      filter: { type: "lowpass", freq: 200, toFreq: 900, q: 1.2 },
    });
    noise(e, {
      at,
      peak: 0.07 * level,
      attack: 0.24,
      decay: 0.22,
      filter: { type: "bandpass", freq: 600, toFreq: 2600, q: 1 },
      send: 0.25,
    });
    bell(e, {
      at: at + 0.26,
      freqs: [hz(deg(7)) * pitch, hz(deg(14)) * pitch],
      peak: 0.11 * level,
      attack: 0.008,
      decay: 0.8,
      send: 0.4,
    });
  },

  /**
   * VICTORY — the fanfare, and worth the two and a half seconds.
   * An arpeggio climbing D-A-D-F, then the whole thing lands on a held D
   * MAJOR chord: the Picardy third, minor key resolving bright, which is
   * the oldest trick there is for making an ending feel earned. Sawtooth
   * pairs slightly detuned for a brass-like body, a shimmer of high air on
   * the chord, and the root deep underneath.
   */
  victory: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    const arp = [0, 4, 7, 9];
    arp.forEach((step, index) => {
      const start = at + index * 0.13;
      for (const detune of [-7, 6]) {
        tone(e, {
          at: start,
          freq: hz(deg(step)) * pitch,
          type: "sawtooth",
          detune,
          peak: 0.09 * level,
          attack: 0.012,
          hold: 0.03,
          decay: 0.3,
          filter: { type: "lowpass", freq: 3400, q: 0.7 },
          send: 0.25,
        });
      }
    });

    const chord = at + arp.length * 0.13;
    // D major on top of a D minor game: root, fifth, octave, and the major
    // third on top — the F natural of the arpeggio lifting a semitone to F#.
    const finale = [hz(deg(0)), hz(deg(4)), hz(deg(7)), hz(TONIC + 16)];
    finale.forEach((freq, index) => {
      for (const detune of [-8, 7]) {
        tone(e, {
          at: chord + index * 0.012,
          freq: freq * pitch,
          type: "sawtooth",
          detune,
          peak: 0.085 * level,
          attack: 0.02,
          hold: 0.35,
          decay: 1.1,
          filter: { type: "lowpass", freq: 4200, q: 0.6 },
          send: 0.35,
        });
      }
    });
    tone(e, {
      at: chord,
      freq: hz(deg(-14)) * pitch,
      type: "sine",
      peak: 0.2 * level,
      attack: 0.02,
      hold: 0.4,
      decay: 1.1,
    });
    noise(e, {
      at: chord,
      peak: 0.05 * level,
      attack: 0.2,
      decay: 1.1,
      rate: 1.2,
      filter: { type: "bandpass", freq: 4000, toFreq: 8000, q: 1.2 },
      send: 0.5,
    });
  },

  /**
   * DEFEAT — the other side of it.
   * Someone just lost to their kid. This falls and settles rather than
   * collapsing: four notes stepping down D-C-A-F with long soft tails, over
   * a low drone that swells once and closes its filter as it goes. Nothing
   * comedic, no sour interval, no final low blat. Dignified, and then over.
   */
  defeat: (e, at, o, level) => {
    const pitch = o.pitch ?? 1;
    const fall = [7, 6, 4, 2];
    fall.forEach((step, index) => {
      tone(e, {
        at: at + index * 0.24,
        freq: hz(deg(step)) * pitch,
        type: "triangle",
        detune: rand(-4, 4),
        peak: (0.13 - index * 0.015) * level,
        attack: 0.04,
        hold: 0.05,
        decay: 0.8,
        filter: { type: "lowpass", freq: 2600, q: 0.6 },
        send: 0.4,
      });
    });
    tone(e, {
      at,
      freq: hz(deg(-14)) * pitch,
      type: "sawtooth",
      peak: 0.13 * level,
      attack: 0.35,
      hold: 0.3,
      decay: 1.3,
      filter: { type: "lowpass", freq: 700, toFreq: 180, q: 0.9 },
      send: 0.3,
    });
    tone(e, {
      at: at + 0.1,
      freq: hz(deg(-10)) * pitch,
      type: "triangle",
      detune: 6,
      peak: 0.07 * level,
      attack: 0.4,
      hold: 0.3,
      decay: 1.2,
      filter: { type: "lowpass", freq: 1200, q: 0.7 },
      send: 0.3,
    });
  },
};

export const CUE_NAMES = Object.keys(CUES) as CueName[];

function play(name: CueName, options: PlayOptions = {}): void {
  const e = live();
  if (!e) return;
  const cue = CUES[name];
  if (!cue) return;
  const ctx = e.ctx;
  if (ctx.state !== "running") return;

  // Never schedule in the past: a late start is a click.
  const at = ctx.currentTime + 0.008 + Math.max(0, options.delay ?? 0);
  let level = clamp(options.gain ?? 1, 0, 1.5);
  if (reducedMotion && JARRING.has(name)) level *= 0.55;
  cue(e, at, options, level);
}

/* ------------------------------------------------------------------ *
 * Ambient bed.
 *
 * A low D drone with two detuned voices and a fifth above it, a band of
 * filtered noise standing in for the ship's air system, and a set of very
 * slow LFOs so nothing ever sits still. Every nine to twenty seconds a
 * distant metallic sweep drifts past, panned somewhere random, so the bed
 * never announces a loop point.
 *
 * Intensity is the match getting desperate: the bed lifts a little, the sub
 * comes up, the filters open and move faster, the sweeps come more often,
 * and above about half a faint heartbeat starts under everything. It starts
 * from silence and takes five seconds to arrive — never at full volume.
 * ------------------------------------------------------------------ */

type Bed = {
  osc: OscillatorNode[];
  lfo: OscillatorNode[];
  air: AudioBufferSourceNode;
  nodes: AudioNode[];
  droneFilter: BiquadFilterNode;
  airFilter: BiquadFilterNode;
  sub: GainNode;
  dead: boolean;
};

/** A bed that has been asked to stop and is living out its fade. */
type FadingBed = { bed: Bed; timer: number | null };

let bed: Bed | null = null;
let bedIntensity = 0.25;
let sweepTimer: number | null = null;
let heartTimer: number | null = null;
/** Beds mid-fade. Each owns its own teardown, so a fast stop/start cannot
 *  orphan the previous one's oscillators. */
let fading: FadingBed[] = [];

function bedTarget(): number {
  return AMBIENT_QUIET + (AMBIENT_LOUD - AMBIENT_QUIET) * bedIntensity;
}

function clearTimer(id: number | null): null {
  if (id !== null && typeof window !== "undefined") window.clearTimeout(id);
  return null;
}

/** A distant sweep: metal moving somewhere else in the ship. */
function playSweep(e: Engine): void {
  const at = e.ctx.currentTime + 0.05;
  const pan = rand(-0.85, 0.85);
  const base = hz(deg(rand(0, 1) > 0.5 ? 11 : 14)) * wobble(30);
  noise(e, {
    at,
    peak: (0.02 + bedIntensity * 0.025) * (reducedMotion ? 0.5 : 1),
    attack: 0.9,
    decay: 1.6,
    rate: rand(0.6, 1.2),
    filter: { type: "bandpass", freq: rand(700, 1400), toFreq: rand(2200, 4200), q: 4 },
    send: 0.7,
    pan,
    dest: e.bed,
  });
  tone(e, {
    at: at + 0.4,
    freq: base,
    toFreq: base * rand(0.94, 1.06),
    glide: 1.6,
    type: "sine",
    peak: 0.022 + bedIntensity * 0.02,
    attack: 0.7,
    decay: 1.4,
    send: 0.8,
    pan: -pan,
    dest: e.bed,
  });
}

function scheduleSweep(): void {
  if (typeof window === "undefined") return;
  const gap = rand(9, 20) - bedIntensity * 4.5;
  sweepTimer = window.setTimeout(() => {
    const e = live();
    // A suspended context (backgrounded tab) has a frozen clock: scheduling
    // into it would pile up voices that never end.
    if (e && bed && e.ctx.state === "running") playSweep(e);
    if (bed) scheduleSweep();
  }, gap * 1000);
}

/** Lub-dub, felt more than heard, and only when things are going badly. */
function scheduleHeart(): void {
  if (typeof window === "undefined") return;
  const beating = bedIntensity > 0.45 && !reducedMotion;
  // Idle far apart until the match actually gets tense.
  const period = beating ? 1.2 - bedIntensity * 0.3 : 2;
  heartTimer = window.setTimeout(() => {
    const e = live();
    if (e && bed && beating && e.ctx.state === "running") {
      const at = e.ctx.currentTime + 0.03;
      const strength = (bedIntensity - 0.45) * 0.16;
      for (const offset of [0, 0.16]) {
        tone(e, {
          at: at + offset,
          freq: 58,
          toFreq: 40,
          glide: 0.12,
          type: "sine",
          peak: strength * (offset === 0 ? 1 : 0.7),
          attack: 0.01,
          decay: 0.22,
          dest: e.bed,
        });
      }
    }
    if (bed) scheduleHeart();
  }, period * 1000);
}

function applyIntensity(e: Engine, immediate: boolean): void {
  const now = e.ctx.currentTime;
  const glide = immediate ? 0.05 : 1.6;
  e.bed.gain.setTargetAtTime(bedTarget(), now, glide);
  if (!bed) return;
  bed.droneFilter.frequency.setTargetAtTime(190 + bedIntensity * 900, now, glide);
  bed.sub.gain.setTargetAtTime(0.12 + bedIntensity * 0.55, now, glide);
  bed.airFilter.Q.setTargetAtTime(0.8 + bedIntensity * 3, now, glide);
}

/** Stop and free one bed's nodes. Safe to call twice. */
function killBed(target: Bed): void {
  if (target.dead) return;
  target.dead = true;
  for (const node of [...target.osc, ...target.lfo]) {
    try {
      node.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    node.disconnect();
  }
  try {
    target.air.stop();
  } catch {
    // Already stopped.
  }
  target.air.disconnect();
  for (const node of target.nodes) node.disconnect();
}

/** Cut short any bed still fading out — used before a fresh start. */
function flushFading(): void {
  for (const entry of fading) {
    entry.timer = clearTimer(entry.timer);
    killBed(entry.bed);
  }
  fading = [];
}

function startBed(): void {
  const e = live();
  if (!e || bed) return;
  flushFading();
  const ctx = e.ctx;
  const now = ctx.currentTime;
  const nodes: AudioNode[] = [];

  // The drone: two detuned saws on D2 and a triangle on the fifth above.
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 190 + bedIntensity * 900;
  droneFilter.Q.value = 0.9;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.5;
  droneFilter.connect(droneGain);
  droneGain.connect(e.bed);
  nodes.push(droneFilter, droneGain);

  const osc: OscillatorNode[] = [];
  const drone = ctx.createOscillator();
  drone.type = "sawtooth";
  drone.frequency.value = hz(deg(-14)); // D2
  drone.connect(droneFilter);
  osc.push(drone);

  const droneDetuned = ctx.createOscillator();
  droneDetuned.type = "sawtooth";
  droneDetuned.frequency.value = hz(deg(-14));
  droneDetuned.detune.value = 9;
  droneDetuned.connect(droneFilter);
  osc.push(droneDetuned);

  const fifth = ctx.createOscillator();
  fifth.type = "triangle";
  fifth.frequency.value = hz(deg(-10)); // A2
  fifth.detune.value = -6;
  const fifthGain = ctx.createGain();
  fifthGain.gain.value = 0.35;
  fifth.connect(fifthGain);
  fifthGain.connect(droneFilter);
  nodes.push(fifthGain);
  osc.push(fifth);

  // The sub: pure weight, rides intensity.
  const subOsc = ctx.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.value = hz(deg(-21)); // D1
  const sub = ctx.createGain();
  sub.gain.value = 0.12 + bedIntensity * 0.55;
  subOsc.connect(sub);
  sub.connect(e.bed);
  nodes.push(sub);
  osc.push(subOsc);

  // The air system: looped noise through a slow, wandering bandpass.
  const air = ctx.createBufferSource();
  air.buffer = e.noise;
  air.loop = true;
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = "bandpass";
  airFilter.frequency.value = 620;
  airFilter.Q.value = 0.8 + bedIntensity * 3;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.5;
  air.connect(airFilter);
  airFilter.connect(airGain);
  airGain.connect(e.bed);
  nodes.push(airFilter, airGain);

  // Four very slow LFOs. Between them the bed never repeats a state.
  const lfo: OscillatorNode[] = [];
  const addLfo = (rate: number, depth: number, target: AudioParam): void => {
    const source = ctx.createOscillator();
    source.type = "sine";
    source.frequency.value = rate;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    source.connect(amount);
    amount.connect(target);
    nodes.push(amount);
    lfo.push(source);
  };
  addLfo(0.047, 90, droneFilter.frequency);
  addLfo(0.031, 260, airFilter.frequency);
  addLfo(0.017, 7, droneDetuned.detune);
  // Wandering the loop's playback rate hides the seam in the noise buffer.
  addLfo(0.023, 0.05, air.playbackRate);

  e.bed.gain.cancelScheduledValues(now);
  e.bed.gain.setValueAtTime(0, now);
  e.bed.gain.linearRampToValueAtTime(bedTarget(), now + 5);

  for (const node of [...osc, ...lfo]) node.start(now);
  air.start(now, Math.random() * (e.noise.duration - 0.5));

  bed = { osc, lfo, air, nodes, droneFilter, airFilter, sub, dead: false };
  scheduleSweep();
  scheduleHeart();
}

function stopBed(): void {
  sweepTimer = clearTimer(sweepTimer);
  heartTimer = clearTimer(heartTimer);
  const current = bed;
  bed = null;
  if (!current) return;
  const e = engine;
  if (!e || e.ctx.state === "closed" || typeof window === "undefined") {
    killBed(current);
    return;
  }

  const now = e.ctx.currentTime;
  e.bed.gain.cancelScheduledValues(now);
  e.bed.gain.setValueAtTime(Math.max(e.bed.gain.value, FLOOR), now);
  e.bed.gain.linearRampToValueAtTime(0, now + 1.2);

  // This bed owns its own teardown from here. Starting a new bed before the
  // fade finishes flushes it rather than cancelling it, so nothing is ever
  // left oscillating into a disconnected graph.
  const entry: FadingBed = { bed: current, timer: null };
  fading.push(entry);
  entry.timer = window.setTimeout(() => {
    entry.timer = null;
    fading = fading.filter((item) => item !== entry);
    killBed(current);
  }, 1400);
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export const audio = {
  /** Call on the first real gesture. Idempotent, and safe to call early. */
  unlock,

  /** True once the context exists and is actually running. */
  get ready(): boolean {
    return live() !== null;
  },

  get muted(): boolean {
    return readPrefs().muted;
  },

  setMuted(value: boolean): void {
    const p = readPrefs();
    p.muted = value;
    writePrefs();
    if (engine) engine.master.gain.setTargetAtTime(masterLevel(), engine.ctx.currentTime, 0.03);
  },

  toggleMuted(): boolean {
    audio.setMuted(!readPrefs().muted);
    return readPrefs().muted;
  },

  get volume(): number {
    return readPrefs().volume;
  },

  /** 0..1, remembered across sessions. */
  setVolume(value: number): void {
    const p = readPrefs();
    p.volume = clamp(Number.isFinite(value) ? value : 0, 0, 1);
    writePrefs();
    if (engine) engine.master.gain.setTargetAtTime(masterLevel(), engine.ctx.currentTime, 0.03);
  },

  /** Fire a cue. Silently does nothing before unlock. */
  play,

  /** Every cue name, for a sound test screen. */
  cues: CUE_NAMES as readonly CueName[],

  ambient: {
    /** Fades in from silence over five seconds. */
    start: startBed,
    /** Fades out over a second and then frees every node. */
    stop: stopBed,
    get running(): boolean {
      return bed !== null;
    },
    get intensity(): number {
      return bedIntensity;
    },
    /** 0 is a calm opening, 1 is a match about to end badly. */
    setIntensity(value: number): void {
      bedIntensity = clamp(Number.isFinite(value) ? value : 0, 0, 1);
      const e = live();
      if (e) applyIntensity(e, false);
    },
  },

  /**
   * Stop everything and release the context. For a full teardown — the
   * module is happy to be left alone otherwise.
   */
  dispose(): void {
    stopBed();
    flushFading();
    const e = engine;
    engine = null;
    unlocked = false;
    if (!e) return;
    void e.ctx.close().catch(() => undefined);
  },
};

export default audio;
