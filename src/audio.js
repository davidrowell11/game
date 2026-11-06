// Tiny WebAudio synthesiser: every sound effect is generated at runtime.
let ctx = null;
let master = null;
let noiseBuf = null;
let volume = 0.6;

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

export function unlockAudio() {
  if (ensure() && ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

function tone({ type = 'square', f0 = 440, f1 = f0, dur = 0.12, gain = 0.2, delay = 0 }) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.1, gain = 0.2, freq = 2000, type = 'bandpass', q = 1, delay = 0 }) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  swing: () => noise({ dur: 0.12, gain: 0.25, freq: 2600, q: 0.8 }),
  hit: () => {
    tone({ type: 'square', f0: 220, f1: 90, dur: 0.09, gain: 0.12 });
    noise({ dur: 0.06, gain: 0.2, freq: 900 });
  },
  crit: () => {
    tone({ type: 'sawtooth', f0: 520, f1: 140, dur: 0.14, gain: 0.12 });
    noise({ dur: 0.08, gain: 0.25, freq: 1500 });
  },
  bolt: () => tone({ type: 'sine', f0: 380, f1: 1100, dur: 0.15, gain: 0.12 }),
  enemyShot: () => tone({ type: 'triangle', f0: 600, f1: 250, dur: 0.18, gain: 0.08 }),
  hurt: () => {
    tone({ type: 'sawtooth', f0: 160, f1: 60, dur: 0.25, gain: 0.2 });
    noise({ dur: 0.15, gain: 0.2, freq: 400 });
  },
  dash: () => noise({ dur: 0.18, gain: 0.18, freq: 800, type: 'lowpass' }),
  pickup: () => tone({ type: 'triangle', f0: 900, f1: 1400, dur: 0.06, gain: 0.07 }),
  coin: () => {
    tone({ type: 'square', f0: 1300, dur: 0.05, gain: 0.05 });
    tone({ type: 'square', f0: 1750, dur: 0.08, gain: 0.05, delay: 0.05 });
  },
  potion: () => [400, 500, 650].forEach((f, i) => tone({ type: 'sine', f0: f, f1: f * 1.5, dur: 0.15, gain: 0.1, delay: i * 0.07 })),
  levelUp: () => [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.2, gain: 0.12, delay: i * 0.08 })),
  enemyDie: () => {
    noise({ dur: 0.25, gain: 0.2, freq: 600, type: 'lowpass' });
    tone({ type: 'square', f0: 180, f1: 40, dur: 0.22, gain: 0.08 });
  },
  chest: () => [392, 523, 659, 784, 988].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.18, gain: 0.1, delay: i * 0.06 })),
  stairs: () => [300, 250, 200, 150].forEach((f, i) => tone({ type: 'sine', f0: f, f1: f * 0.7, dur: 0.3, gain: 0.12, delay: i * 0.1 })),
  fuse: () => tone({ type: 'square', f0: 1400, dur: 0.05, gain: 0.06 }),
  boom: () => {
    noise({ dur: 0.6, gain: 0.45, freq: 260, type: 'lowpass' });
    tone({ type: 'sine', f0: 120, f1: 30, dur: 0.5, gain: 0.3 });
  },
  shatter: () => {
    noise({ dur: 0.18, gain: 0.25, freq: 3200, q: 2 });
    tone({ type: 'triangle', f0: 900, f1: 500, dur: 0.1, gain: 0.05 });
  },
  spike: () => noise({ dur: 0.08, gain: 0.12, freq: 4200, q: 3 }),
  buy: () => [880, 1320].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.08, gain: 0.06, delay: i * 0.07 })),
  windup: () => tone({ type: 'sawtooth', f0: 90, f1: 160, dur: 0.3, gain: 0.05 }),
  roar: () => {
    tone({ type: 'sawtooth', f0: 70, f1: 40, dur: 1.0, gain: 0.25 });
    noise({ dur: 0.9, gain: 0.25, freq: 300, type: 'lowpass' });
  },
  death: () => [400, 300, 220, 150, 90].forEach((f, i) => tone({ type: 'sawtooth', f0: f, f1: f * 0.8, dur: 0.35, gain: 0.12, delay: i * 0.15 })),
  click: () => tone({ type: 'square', f0: 700, dur: 0.04, gain: 0.05 }),
};

// A low, slowly-moving drone for atmosphere.
let drone = null;
export function startDrone() {
  if (!ensure() || drone) return;
  const g = ctx.createGain();
  g.gain.value = 0.035;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 220;
  const oscs = [55, 55.4, 82.5].map((hz) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    o.connect(f);
    o.start();
    return o;
  });
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain).connect(f.frequency);
  lfo.start();
  f.connect(g).connect(master);
  drone = { oscs, lfo };
}
