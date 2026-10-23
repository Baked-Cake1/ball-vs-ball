/* =========================================================================
   effects.js — lightweight particle / popup system shared by both fighters.
   Everything lives in one flat list and is drawn between the balls and the HUD.
   ========================================================================= */

const Effects = {
  list: [],
  popups: [],

  clear() { this.list.length = 0; this.popups.length = 0; },

  /* -- generic spawners ------------------------------------------------- */

  add(p) {
    p.age = 0;
    this.list.push(p);
    if (this.list.length > 700) this.list.splice(0, this.list.length - 700);
    return p;
  },

  /** Radial burst of sparks (used for electricity arcs and impacts). */
  sparks(x, y, count, opts = {}) {
    const {
      color = '#7df9ff', speed = [90, 340], size = [1.5, 4], life = [0.25, 0.7],
      spread = TAU, dir = 0, gravity = 0, drag = 2.2, glow = true,
    } = opts;
    for (let i = 0; i < count; i++) {
      const a = dir + Utils.rand(-spread / 2, spread / 2);
      const s = Utils.rand(speed[0], speed[1]);
      this.add({
        kind: 'spark', x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: Utils.rand(life[0], life[1]),
        size: Utils.rand(size[0], size[1]),
        color, gravity, drag, glow,
      });
    }
  },

  /** Lightning arc: a jagged polyline through a set of random offshoots. */
  arc(x, y, len, opts = {}) {
    const {
      color = '#bffcff', width = 2.4, jag = 12, angle = Utils.rand(0, TAU),
      life = 0.18, branches = 2, glow = true,
    } = opts;
    const points = [{ x, y }];
    const steps = 5;
    let px = x, py = y;
    for (let i = 0; i < steps; i++) {
      px += Math.cos(angle) * (len / steps) + Utils.rand(-jag, jag);
      py += Math.sin(angle) * (len / steps) + Utils.rand(-jag, jag);
      points.push({ x: px, y: py });
    }
    const children = [];
    for (let b = 0; b < branches; b++) {
      const p = Utils.pick(points.slice(1));
      const childAngle = angle + Utils.rand(-1.1, 1.1);
      const cPoints = [{ x: p.x, y: p.y }];
      let cx = p.x, cy = p.y;
      for (let i = 0; i < 3; i++) {
        cx += Math.cos(childAngle) * (len / steps / 1.6) + Utils.rand(-jag, jag);
        cy += Math.sin(childAngle) * (len / steps / 1.6) + Utils.rand(-jag, jag);
        cPoints.push({ x: cx, y: cy });
      }
      children.push(cPoints);
    }
    this.add({ kind: 'arc', points, children, color, width, life, age: 0, glow });
  },

  /** Expanding ring — reads as a shockwave / bite snap. */
  ring(x, y, opts = {}) {
    const { color = '#fff', from = 8, to = 60, life = 0.36, width = 4, fill = false } = opts;
    this.add({ kind: 'ring', x, y, from, to, color, width, life, fill });
  },

  /** Blood droplets for the vampire. */
  blood(x, y, count, opts = {}) {
    this.sparks(x, y, count, {
      color: '#c81f36', speed: [60, 260], size: [2, 5], life: [0.35, 0.85],
      gravity: 420, drag: 1.4, glow: false, ...opts,
    });
  },

  slash(x, y, angle, opts = {}) {
    const { color = '#ff5a72', length = 46, life = 0.24, width = 5 } = opts;
    this.add({ kind: 'slash', x, y, angle, length, color, life, width });
  },

  /** Floating damage / heal number. */
  popup(x, y, text, opts = {}) {
    const { color = '#fff', size = 26, life = 0.95, crit = false, vy = -68 } = opts;
    this.popups.push({
      x, y, text, color, size, life, age: 0, vy, crit,
      drift: Utils.rand(-26, 26),
    });
    if (this.popups.length > 60) this.popups.shift();
  },

  /* -- update / draw ---------------------------------------------------- */

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      if (p.kind === 'spark') {
        p.vy += (p.gravity || 0) * dt;
        const damp = Math.max(0, 1 - (p.drag || 0) * dt);
        p.vx *= damp; p.vy *= damp;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      if (p.age >= p.life) { this.popups.splice(i, 1); continue; }
      p.y += p.vy * dt;
      p.x += p.drift * dt;
      p.vy += 46 * dt;
    }
  },

  draw(ctx) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const p of this.list) {
      const t = Utils.clamp(p.age / p.life, 0, 1);
      const alpha = 1 - t;

      if (p.kind === 'spark') {
        ctx.globalAlpha = alpha;
        if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 12; } else ctx.shadowBlur = 0;
        ctx.fillStyle = p.color;
        const s = p.size * (1 - t * 0.55);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, s), 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (p.kind === 'arc' || p.kind === 'slash') {
        const fade = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        ctx.globalAlpha = Utils.clamp(fade, 0, 1);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = (p.width || 2.5) * (1 - t * 0.4);
        if (p.glow !== false) { ctx.shadowColor = p.color; ctx.shadowBlur = 16; }

        if (p.kind === 'arc') {
          this.strokePath(ctx, p.points);
          ctx.lineWidth = Math.max(1, ctx.lineWidth * 0.55);
          for (const c of p.children) this.strokePath(ctx, c);
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.beginPath();
          ctx.arc(0, 0, p.length, -0.7, 0.7);
          ctx.stroke();
          ctx.restore();
        }
        ctx.shadowBlur = 0;
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = alpha;
        const r = Utils.lerp(p.from, p.to, Utils.easeOutCubic(t));
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width * (1 - t);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.stroke();
        if (p.fill) {
          ctx.globalAlpha = alpha * 0.26;
          ctx.fillStyle = p.color;
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const t = p.age / p.life;
      const alpha = t < 0.15 ? t / 0.15 : (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      const pop = t < 0.18 ? Utils.lerp(1.5, 1, t / 0.18) : 1;
      ctx.globalAlpha = Utils.clamp(alpha, 0, 1);
      ctx.font = `900 ${p.size * pop}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      if (p.crit) { ctx.shadowColor = p.color; ctx.shadowBlur = 12; }
      ctx.fillText(p.text, p.x, p.y);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  },

  strokePath(ctx, pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  },
};
