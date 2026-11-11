// Every sound is synthesised with WebAudio: no asset files to load.
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
    this.coinStep = 0;
    this.coinT = 0;
    this.hum = null;
    this.beatOn = false;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
      this.master.connect(comp); comp.connect(ctx.destination);
      // tiny feedback-delay "cave" echo
      this.echo = ctx.createDelay(0.6); this.echo.delayTime.value = 0.21;
      const fb = ctx.createGain(); fb.gain.value = 0.34;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      this.echo.connect(lp); lp.connect(fb); fb.connect(this.echo); lp.connect(this.master);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
    } catch (e) { this.ctx = null; }
  }
  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }
  ok(key, gap) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (key && this.last[key] && now - this.last[key] < gap) return false;
    if (key) this.last[key] = now;
    return true;
  }

  // ------------------------------------------------------------ building blocks
  tone(o) {
    const ctx = this.ctx, t = ctx.currentTime + (o.when || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(this.master);
    if (o.echo) { const s = ctx.createGain(); s.gain.value = o.echo; g.connect(s); s.connect(this.echo); }
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }
  noise(o) {
    const ctx = this.ctx, t = ctx.currentTime + (o.when || 0);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    if (o.echo) { const s = ctx.createGain(); s.gain.value = o.echo; g.connect(s); s.connect(this.echo); }
    src.start(t, Math.random() * 0.8); src.stop(t + o.dur + 0.03);
  }

  // ------------------------------------------------------------ ambience + beat
  startAmbient() {
    const ctx = this.ctx;
    const g = this.ambGain = ctx.createGain(); g.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    for (const f of [55, 55.6, 82.4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
    lp.connect(g); g.connect(this.master);
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuf; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 320; wf.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.022;
    wind.connect(wf); wf.connect(wg); wg.connect(this.master); wind.start();
    this.dripTimer = setInterval(() => {
      if (!this.ok() || Math.random() < 0.45) return;
      const f = 900 + Math.random() * 900;
      this.tone({ f0: f, f1: f * 0.55, dur: 0.09, gain: 0.035, echo: 0.9 });
    }, 2300);
  }
  /** Soft war-drum pulse while a run is in progress. intensity 0..1 */
  setBeat(on, intensity = 0) {
    this.beatIntensity = intensity;
    if (on === this.beatOn) return;
    this.beatOn = on;
    clearInterval(this.beatTimer);
    if (!on) return;
    let step = 0;
    this.beatTimer = setInterval(() => {
      if (!this.ok()) return;
      const s = step++ % 8, k = this.beatIntensity;
      if (s === 0 || s === 3 || s === 6) this.tone({ f0: 92, f1: 42, dur: 0.22, gain: 0.16 + k * 0.08 });
      if (s === 4) this.noise({ f0: 1800, dur: 0.07, gain: 0.03 + k * 0.03, type: 'highpass' });
      if (k > 0.5 && (s === 2 || s === 5 || s === 7)) this.noise({ f0: 5000, dur: 0.03, gain: 0.02, type: 'highpass' });
      if (s === 0 && Math.random() < 0.5) { const n = 45 + PENTA[(Math.random() * 5) | 0]; this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.5, gain: 0.035, echo: 0.6 }); }
    }, 136);
  }

  // ------------------------------------------------------------ spells
  cast(rune) {
    if (!this.ok('cast' + rune, 0.07)) return;
    if (rune === 'ember') { this.noise({ f0: 400, f1: 1800, dur: 0.2, gain: 0.12 }); this.tone({ f0: 240, f1: 110, dur: 0.18, gain: 0.08, type: 'triangle' }); }
    else if (rune === 'storm') { this.tone({ type: 'sawtooth', f0: 2200, f1: 180, dur: 0.1, gain: 0.07 }); this.noise({ f0: 4000, dur: 0.09, gain: 0.09, type: 'highpass' }); }
    else if (rune === 'frost') { this.tone({ type: 'triangle', f0: 1500, f1: 2600, dur: 0.14, gain: 0.07, echo: 0.3 }); this.noise({ f0: 6000, dur: 0.1, gain: 0.05, type: 'highpass' }); }
    else if (rune === 'arcane') { for (let i = 0; i < 3; i++) this.tone({ f0: 560 + i * 140, f1: 980 + i * 180, dur: 0.11, gain: 0.05, when: i * 0.05, echo: 0.3 }); }
    else if (rune === 'cleave') { this.noise({ f0: 700, f1: 3200, dur: 0.12, gain: 0.09, type: 'bandpass', q: 1.5 }); this.tone({ type: 'triangle', f0: 320, f1: 140, dur: 0.1, gain: 0.05 }); }
    else if (rune === 'hurl') { this.noise({ f0: 1200, f1: 3000, dur: 0.14, gain: 0.07, type: 'bandpass', q: 3 }); }
    else if (rune === 'quake') { this.tone({ f0: 90, f1: 34, dur: 0.4, gain: 0.26 }); this.noise({ f0: 700, f1: 80, dur: 0.35, gain: 0.16 }); }
    else if (rune === 'whirl') { this.noise({ f0: 500, f1: 1800, dur: 0.16, gain: 0.05, type: 'bandpass', q: 2 }); }
    else if (rune === 'crown') { this.tone({ type: 'triangle', f0: 1320, f1: 660, dur: 0.4, gain: 0.08, echo: 0.6 }); this.noise({ f0: 4000, f1: 600, dur: 0.38, gain: 0.06, attack: 0.25 }); }
    else if (rune === 'void') { this.tone({ f0: 160, f1: 38, dur: 0.9, gain: 0.2 }); this.noise({ f0: 200, f1: 2400, dur: 0.8, gain: 0.07, attack: 0.5 }); }
  }
  explode(kind) {
    if (!this.ok('exp' + kind, 0.06)) return;
    const big = kind === 'meteor' || kind === 'nova' ? 1.8 : kind === 'corpse' ? 0.5 : 1;
    this.noise({ f0: 1400 * big, f1: 70, dur: 0.38 * big, gain: 0.26 * Math.min(1.4, big), echo: 0.25 });
    this.tone({ f0: 120, f1: 36, dur: 0.3 * big, gain: 0.25 * Math.min(1.3, big) });
    if (kind === 'overload') this.tone({ type: 'square', f0: 1400, f1: 200, dur: 0.12, gain: 0.06 });
    if (kind === 'void') this.tone({ f0: 60, f1: 600, dur: 0.25, gain: 0.12 });
  }
  hit(element, crit) {
    if (!this.ok('hit', 0.045)) return;
    this.noise({ f0: crit ? 2600 : 1500, dur: 0.05, gain: crit ? 0.1 : 0.05, type: 'bandpass', q: 2 });
    if (crit) this.tone({ type: 'triangle', f0: 1900, f1: 900, dur: 0.09, gain: 0.07 });
  }
  kill(heavy) {
    if (!this.ok('kill', 0.05)) return;
    this.noise({ f0: 700, f1: 120, dur: heavy ? 0.4 : 0.16, gain: heavy ? 0.22 : 0.11, type: 'bandpass', q: 1.2 });
    this.tone({ f0: heavy ? 110 : 170, f1: 50, dur: heavy ? 0.4 : 0.14, gain: heavy ? 0.24 : 0.12 });
  }
  react() { if (this.ok('react', 0.1)) { this.tone({ type: 'triangle', f0: 880, f1: 1760, dur: 0.16, gain: 0.08, echo: 0.5 }); } }
  coin() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - (this.last.coin || 0) < 0.035) return;
    if (now - this.coinT > 0.9) this.coinStep = 0;
    this.coinT = now; this.last.coin = now;
    const n = 84 + PENTA[Math.min(PENTA.length - 1, this.coinStep >> 1)];
    this.coinStep = Math.min(this.coinStep + 1, PENTA.length * 2 - 1);
    this.tone({ type: 'square', f0: NOTE(n), dur: 0.05, gain: 0.03 });
    this.tone({ type: 'square', f0: NOTE(n + 7), dur: 0.14, gain: 0.035, when: 0.045, echo: 0.25 });
  }
  throwAxe() { if (this.ok('throw', 0.08)) this.noise({ f0: 900, f1: 2600, dur: 0.13, gain: 0.045, type: 'bandpass', q: 3 }); }
  horde() { if (this.ok('horde', 1)) { for (let i = 0; i < 5; i++) this.tone({ type: 'sawtooth', f0: 520 + Math.random() * 300, f1: 300 + Math.random() * 150, dur: 0.28, gain: 0.04, when: i * 0.06, echo: 0.5 }); } }
  enemySwing() { if (this.ok('swing', 0.09)) this.noise({ f0: 500, f1: 1600, dur: 0.11, gain: 0.05, type: 'bandpass' }); }
  mageHurt(shielded) {
    if (!this.ok('hurt', 0.07)) return;
    if (shielded) this.tone({ f0: 1100, f1: 620, dur: 0.12, gain: 0.08, echo: 0.3 });
    else { this.tone({ type: 'square', f0: 190, f1: 80, dur: 0.14, gain: 0.11 }); this.noise({ f0: 900, f1: 200, dur: 0.12, gain: 0.12 }); }
  }
  shieldBreak() { if (this.ok('sb', 0.2)) { this.noise({ f0: 5000, f1: 900, dur: 0.3, gain: 0.14, type: 'highpass' }); this.tone({ f0: 1400, f1: 300, dur: 0.3, gain: 0.08 }); } }
  death() {
    if (!this.ok()) return;
    this.tone({ type: 'sawtooth', f0: 420, f1: 44, dur: 1.1, gain: 0.16, echo: 0.5 });
    this.noise({ f0: 2000, f1: 80, dur: 1.0, gain: 0.14 });
  }
  revive() { if (this.ok()) [0, 4, 7, 12, 16].forEach((s, i) => this.tone({ type: 'triangle', f0: NOTE(64 + s), dur: 0.35, gain: 0.1, when: i * 0.06, echo: 0.6 })); }
  roar() {
    if (!this.ok('roar', 0.5)) return;
    this.tone({ type: 'sawtooth', f0: 95, f1: 48, dur: 1.3, gain: 0.26, attack: 0.08, echo: 0.5 });
    this.tone({ type: 'sawtooth', f0: 143, f1: 60, dur: 1.2, gain: 0.14, attack: 0.1 });
    this.noise({ f0: 500, f1: 150, dur: 1.2, gain: 0.2, attack: 0.1 });
  }
  slam() { if (this.ok('slam', 0.2)) { this.tone({ f0: 80, f1: 28, dur: 0.6, gain: 0.34 }); this.noise({ f0: 900, f1: 60, dur: 0.55, gain: 0.26 }); } }
  meteorFall() { if (this.ok('mf', 0.2)) this.noise({ f0: 3000, f1: 300, dur: 0.75, gain: 0.1, attack: 0.5, type: 'bandpass', q: 3 }); }
  zone(name) { if (this.ok('zone', 1)) [0, 7, 12].forEach((s, i) => this.tone({ type: 'triangle', f0: NOTE(50 + s), dur: 1.2, gain: 0.08, when: i * 0.16, echo: 0.7 })); }
  lootSpotted() { if (this.ok('loot', 0.5)) [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'square', f0: NOTE(79 + s), dur: 0.09, gain: 0.04, when: i * 0.05, echo: 0.4 })); }

  // ------------------------------------------------------------ rune drawing
  humStart() {
    if (!this.ctx || this.hum) return;
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.value = 0.0001;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'triangle'; o2.type = 'sine';
    o1.frequency.value = 220; o2.frequency.value = 331;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.echo);
    o1.start(); o2.start();
    this.hum = { g, o1, o2 };
  }
  /** speed in px/ms-ish 0..1 */
  humSet(speed) {
    if (!this.hum) return;
    const t = this.ctx.currentTime, k = Math.min(1, speed);
    this.hum.g.gain.setTargetAtTime(this.muted ? 0 : 0.02 + k * 0.07, t, 0.04);
    this.hum.o1.frequency.setTargetAtTime(200 + k * 420, t, 0.06);
    this.hum.o2.frequency.setTargetAtTime(300 + k * 640, t, 0.06);
  }
  humStop() {
    if (!this.hum) return;
    const h = this.hum, t = this.ctx.currentTime;
    this.hum = null;
    h.g.gain.setTargetAtTime(0.0001, t, 0.05);
    h.o1.stop(t + 0.4); h.o2.stop(t + 0.4);
  }
  runeResult(grade) {
    if (!this.ok()) return;
    const n = { S: 5, A: 4, B: 3, C: 2, D: 2 }[grade] || 2;
    const base = { S: 72, A: 69, B: 67, C: 64, D: 60 }[grade] || 60;
    for (let i = 0; i < n; i++) this.tone({ type: 'triangle', f0: NOTE(base + [0, 4, 7, 12, 16][i]), dur: 0.5, gain: 0.1, when: i * 0.055, echo: 0.7 });
    this.noise({ f0: 800, f1: 5000, dur: 0.4, gain: 0.07, type: 'bandpass', q: 2 });
    if (grade === 'S') this.tone({ f0: NOTE(96), dur: 0.9, gain: 0.05, when: 0.3, echo: 0.9 });
  }
  fizzle() { if (this.ok()) { this.tone({ type: 'sawtooth', f0: 320, f1: 70, dur: 0.3, gain: 0.09 }); this.noise({ f0: 2500, f1: 300, dur: 0.3, gain: 0.07 }); } }
  runStart() { if (this.ok()) { this.noise({ f0: 300, f1: 4000, dur: 0.5, gain: 0.12, attack: 0.3 }); this.tone({ f0: 110, f1: 440, dur: 0.5, gain: 0.12, attack: 0.3, echo: 0.4 }); } }

  // ------------------------------------------------------------ UI
  click() { if (this.ok('click', 0.03)) this.tone({ type: 'triangle', f0: 760, f1: 540, dur: 0.05, gain: 0.07 }); }
  buy(level = 0) {
    if (!this.ok('buy', 0.03)) return;
    const n = 72 + PENTA[Math.min(level, PENTA.length - 1) % PENTA.length];
    this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.12, gain: 0.11, echo: 0.4 });
    this.tone({ type: 'triangle', f0: NOTE(n + 7), dur: 0.22, gain: 0.11, when: 0.06, echo: 0.5 });
    this.noise({ f0: 6000, dur: 0.06, gain: 0.05, type: 'highpass' });
  }
  deny() { if (this.ok('deny', 0.1)) this.tone({ type: 'square', f0: 140, f1: 100, dur: 0.14, gain: 0.07 }); }
  tick(pitch = 0) { if (this.ok('tick', 0.028)) this.tone({ type: 'square', f0: NOTE(84 + pitch), dur: 0.035, gain: 0.025 }); }
  tally() { if (this.ok('tally', 0.05)) { this.tone({ type: 'triangle', f0: NOTE(76), dur: 0.1, gain: 0.09, echo: 0.4 }); this.tone({ type: 'triangle', f0: NOTE(83), dur: 0.2, gain: 0.09, when: 0.07, echo: 0.5 }); } }
  evolve() {
    if (!this.ok()) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone({ type: 'triangle', f0: NOTE(60 + s), dur: 0.6, gain: 0.12, when: i * 0.08, echo: 0.8 }));
    this.noise({ f0: 400, f1: 7000, dur: 1.1, gain: 0.1, attack: 0.7, type: 'bandpass', q: 1.5 });
    this.tone({ f0: 65, f1: 130, dur: 1.2, gain: 0.2, attack: 0.5 });
  }
  victory() {
    if (!this.ok()) return;
    const seq = [[60, 0], [64, 0.14], [67, 0.28], [72, 0.42], [67, 0.6], [72, 0.74], [76, 0.9], [84, 1.2]];
    for (const [n, w] of seq) { this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.5, gain: 0.13, when: w, echo: 0.7 }); this.tone({ type: 'square', f0: NOTE(n - 12), dur: 0.4, gain: 0.04, when: w }); }
  }
}
