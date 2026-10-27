let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let padA: OscillatorNode | null = null;
let padB: OscillatorNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    const bus = ctx.createGain();
    bus.gain.value = 0.03;
    bus.connect(master);
    padA = ctx.createOscillator();
    padB = ctx.createOscillator();
    padA.type = "sine";
    padB.type = "sine";
    padA.frequency.value = 196;
    padB.frequency.value = 246.9;
    padA.connect(bus);
    padB.connect(bus);
    padA.start();
    padB.start();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function bindAudioLifecycle() {
  const onVis = () => {
    if (document.visibilityState === "visible") void ctx?.resume();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(next ? 0 : 0.9, ctx.currentTime, 0.03);
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0) {
  const context = ac();
  if (!context || !master || muted) return;
  const o = context.createOscillator();
  const g = context.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = context.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

export function playStep(height: number) {
  const base = 523 + height * 36 + Math.random() * 18;
  tone(base, 0.18, "triangle", 0.08);
}

export function playToggle(kind: string) {
  if (kind === "lift") {
    tone(220, 0.28, "sine", 0.07);
    tone(330, 0.34, "sine", 0.05, 0.08);
    return;
  }
  if (kind === "slide") {
    tone(180, 0.16, "sawtooth", 0.03);
    tone(240, 0.2, "triangle", 0.05, 0.05);
    return;
  }
  if (kind === "button") {
    tone(660, 0.22, "sine", 0.06);
    tone(990, 0.28, "sine", 0.04, 0.06);
    return;
  }
  tone(196, 0.2, "triangle", 0.07);
  tone(294, 0.26, "sine", 0.05, 0.04);
}

export function playDeny() {
  tone(140, 0.14, "sine", 0.05);
}

export function playWin() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.4, "sine", 0.07, i * 0.09));
}

export function disposeAudio() {
  padA?.stop();
  padB?.stop();
  padA = null;
  padB = null;
  void ctx?.close();
  ctx = null;
  master = null;
}
