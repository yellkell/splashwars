/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files), tuned to SPLASH WARS' plastic-and-water palette: squirts, plops,
 * glugs and toy-plastic clicks. Core building blocks are `noiseBurst`
 * (filtered noise with an envelope), `blip` (a glided sine) and the
 * squirt LOOP — a bandpassed noise hiss with an LFO warble that runs for as
 * long as the trigger is held.
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame
 * loop play fine.
 */

type Ctx = AudioContext & { _master?: GainNode };

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    const master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(ctx.destination);
    ctx._master = master;
  }
  return ctx;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

/** A shared noise buffer for all the wet sounds. */
let noiseBuf: AudioBuffer | null = null;
function noise(c: Ctx): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Bandpassed noise burst — the basis of every splash. */
function noiseBurst(freq: number, q: number, dur: number, gain: number, sweepTo?: number): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(freq, t);
  if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** A little glided sine — glugs, pops, toy blips. */
function blip(from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c._master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// --- The squirt loop: one per hand, started/stopped by WeaponSystem. -------

interface SquirtVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  lfo: OscillatorNode;
}

const squirts: (SquirtVoice | undefined)[] = [undefined, undefined];

/** Start (or keep running) the pressurised-water hiss for a hand. */
export function squirtStart(hand: 0 | 1): void {
  const c = ready();
  if (!c || squirts[hand]) return;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hand === 0 ? 2300 : 2600; // the pair don't unison
  bp.Q.value = 1.4;
  // LFO warbles the filter so the stream burbles instead of hissing flat.
  const lfo = c.createOscillator();
  lfo.frequency.value = 11 + hand * 2.5;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 420;
  lfo.connect(lfoGain).connect(bp.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.06);
  src.connect(bp).connect(g).connect(c._master!);
  src.start();
  lfo.start();
  squirts[hand] = { src, gain: g, lfo };
}

export function squirtStop(hand: 0 | 1): void {
  const c = ready();
  const v = squirts[hand];
  if (!c || !v) return;
  const t = c.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  v.src.stop(t + 0.12);
  v.lfo.stop(t + 0.12);
  squirts[hand] = undefined;
}

// --- One-shots. ------------------------------------------------------------

/** Paint landing on the deck/floor — a fat wet plop. */
export function splat(): void {
  noiseBurst(900, 1.1, 0.16, 0.22, 300);
  blip(220, 90, 0.1, 0.1);
}

/** Paint landing on an enemy — plasticky slap on top of the plop. */
export function hitSplat(): void {
  noiseBurst(1400, 1.4, 0.12, 0.2, 500);
  blip(500, 180, 0.07, 0.12, 'triangle');
}

/** A fully-painted enemy popping — cork pop + wet shower. */
export function enemyPop(): void {
  blip(300, 950, 0.09, 0.4);
  noiseBurst(700, 0.9, 0.5, 0.3, 200);
}

/** The dry-tank click: toy plastic snapping on nothing. */
export function emptyClick(): void {
  blip(2600, 1400, 0.03, 0.16, 'square');
}

/** Drawing a pistol from the hip — a quick sporty schwip-click. */
export function draw(): void {
  noiseBurst(3200, 2.0, 0.06, 0.12, 5200);
  blip(700, 1150, 0.06, 0.14, 'triangle');
}

/** A gun leaving your hand — heavier whoosh than a paint ball. */
export function throwWhoosh(): void {
  noiseBurst(500, 0.8, 0.3, 0.2, 180);
}

/** A thrown gun bursting — deep plastic crack under a big wet splash. */
export function gunBurst(): void {
  blip(180, 60, 0.14, 0.3, 'square');
  noiseBurst(800, 0.9, 0.45, 0.32, 220);
}

/** An enemy lobbing paint at you — a hollow, sinister underarm whoop. */
export function enemyLob(): void {
  blip(300, 620, 0.16, 0.1, 'sine');
  noiseBurst(700, 1.2, 0.18, 0.07, 1400);
}

/** You getting splatted — a dull wet thud right on the ears. */
export function playerHurt(): void {
  noiseBurst(320, 0.7, 0.28, 0.3, 120);
  blip(150, 70, 0.16, 0.22, 'sine');
}

/** You going down — the whole thing deflating. */
export function playerDown(): void {
  blip(420, 60, 0.9, 0.34, 'sawtooth');
  noiseBurst(500, 0.6, 1.0, 0.22, 90);
}

/** A Paint Bomb going off — a big low whump with a wet tail. */
export function paintBomb(): void {
  blip(150, 40, 0.5, 0.42, 'square');
  noiseBurst(500, 0.6, 0.8, 0.4, 120);
}

/** The upgrade board swinging up. */
export function upgradeAppear(): void {
  blip(440, 660, 0.18, 0.16, 'triangle');
  setTimeout(() => blip(660, 880, 0.22, 0.16, 'triangle'), 130);
}

/** An upgrade taken — a bright confirming chime. */
export function upgradePick(): void {
  blip(660, 990, 0.16, 0.24, 'triangle');
  setTimeout(() => blip(990, 1320, 0.3, 0.22, 'triangle'), 120);
  noiseBurst(900, 0.8, 0.5, 0.1, 2000);
}

/** A new wave rolling in — bright toy fanfare over a water swell. */
export function waveHorn(): void {
  blip(523, 523, 0.16, 0.2, 'triangle');
  setTimeout(() => blip(659, 659, 0.16, 0.2, 'triangle'), 140);
  setTimeout(() => blip(784, 784, 0.28, 0.24, 'triangle'), 280);
  noiseBurst(400, 0.7, 0.8, 0.06, 1200);
}
