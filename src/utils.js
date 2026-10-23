/* =========================================================================
   utils.js — tiny math / formatting helpers used across the project.
   ========================================================================= */

const TAU = Math.PI * 2;

const Utils = {
  clamp(v, min, max) { return v < min ? min : (v > max ? max : v); },

  lerp(a, b, t) { return a + (b - a) * t; },

  /** rand(5) -> 0..5   |   rand(2, 6) -> 2..6 */
  rand(a = 1, b) {
    if (b === undefined) { b = a; a = 0; }
    return a + Math.random() * (b - a);
  },

  randInt(a, b) { return Math.floor(Utils.rand(a, b + 1)); },

  pick(arr) { return arr[Utils.randInt(0, arr.length - 1)]; },

  /** Deterministic pseudo-random in 0..1 for a given seed (used for VFX flicker). */
  noise(seed) {
    const n = Math.sin(seed * 127.1) * 43758.5453;
    return n - Math.floor(n);
  },

  dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },

  easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); },

  /** Shortest signed difference between two angles, radians. */
  angleDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  },

  fmt(n) { return Math.max(0, Math.round(n)).toString(); },

  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  },
};
