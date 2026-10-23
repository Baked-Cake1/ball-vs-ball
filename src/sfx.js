/* =========================================================================
   sfx.js — procedural sound effects (WebAudio). No asset files needed.
   ========================================================================= */

const SFX = {
  ctx: null,
  master: null,
  muted: false,

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  },

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  },

  /* -- low level helpers ------------------------------------------------ */

  tone({ freq = 440, to = null, type = 'sine', dur = 0.16, gain = 0.2, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  noise({ dur = 0.2, gain = 0.2, freq = 1200, to = null, q = 1, type = 'bandpass', delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t0);
    if (to) filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  },

  /* -- game sounds ------------------------------------------------------ */

  uiClick() { this.tone({ freq: 660, to: 900, type: 'triangle', dur: 0.07, gain: 0.12 }); },

  march(step) {
    const f = [520, 620, 760, 980][Utils.clamp(step, 0, 3)] || 700;
    this.tone({ freq: f, type: 'square', dur: 0.12, gain: 0.1 });
  },

  fight() {
    this.tone({ freq: 300, to: 900, type: 'sawtooth', dur: 0.34, gain: 0.16 });
    this.noise({ dur: 0.4, gain: 0.2, freq: 400, to: 3200, type: 'bandpass', q: 0.8 });
  },

  bounce() { this.noise({ dur: 0.07, gain: 0.07, freq: 260, to: 120, type: 'lowpass' }); },

  impact() {
    this.noise({ dur: 0.16, gain: 0.2, freq: 900, to: 200, type: 'lowpass' });
    this.tone({ freq: 150, to: 60, type: 'sine', dur: 0.18, gain: 0.18 });
  },

  zap() {
    this.noise({ dur: 0.3, gain: 0.26, freq: 4200, to: 700, type: 'bandpass', q: 1.1 });
    this.tone({ freq: 1650, to: 240, type: 'square', dur: 0.16, gain: 0.1 });
    this.tone({ freq: 640, to: 90, type: 'sawtooth', dur: 0.24, gain: 0.07, delay: 0.03 });
  },

  crackle() { this.noise({ dur: 0.06, gain: 0.06, freq: 3000, to: 1400, type: 'bandpass', q: 2 }); },

  bite() {
    this.noise({ dur: 0.13, gain: 0.22, freq: 380, to: 90, type: 'lowpass' });
    this.tone({ freq: 220, to: 70, type: 'triangle', dur: 0.14, gain: 0.12 });
  },

  heal() {
    this.tone({ freq: 620, to: 940, type: 'sine', dur: 0.14, gain: 0.09 });
    this.tone({ freq: 940, to: 1300, type: 'sine', dur: 0.14, gain: 0.06, delay: 0.08 });
  },

  ko() {
    this.noise({ dur: 0.9, gain: 0.32, freq: 1400, to: 90, type: 'lowpass' });
    this.tone({ freq: 260, to: 40, type: 'sawtooth', dur: 0.9, gain: 0.2 });
    this.tone({ freq: 120, to: 30, type: 'sine', dur: 1.1, gain: 0.22, delay: 0.05 });
  },

  /** Verity's mood souring: a rising snarl. */
  transform() {
    this.tone({ freq: 180, to: 520, type: 'sawtooth', dur: 0.34, gain: 0.16 });
    this.tone({ freq: 90, to: 260, type: 'square', dur: 0.4, gain: 0.1, delay: 0.04 });
    this.noise({ dur: 0.34, gain: 0.14, freq: 500, to: 2400, type: 'bandpass', q: 1.4 });
  },
};
