/* =========================================================================
   vampire-ball.js
   ---------------------------------------------------------------------------
   Vampire Ball — a red ball with fangs that always turns to face its opponent.
   Ability "Blood Bite":
     - when the fangs touch the opponent the vampire GRIPS ON: both fighters
       are frozen in place for the whole bite sequence, because the vampire is
       latched onto its prey and cannot move either
     - 4 bites of 25 damage each, spaced out by a short delay
     - every point of damage dealt is stolen back as the vampire's own health
     - when the bite finishes both fighters get their original velocity back
   Visuals: the head is drawn in top-down view — bat ears and a widow's peak
   face the way the vampire looks (+x), a dark cape billows out behind it, the
   body carries a slow heartbeat glow, and freshly bitten fangs drip blood.
   ========================================================================= */

class VampireBall extends Ball {
  constructor(def, opts) {
    super(def, opts);
    this.volley = null;        // active bite sequence
    this.grip = null;          // { offsetX, offsetY } while latched on
    this.biteFlash = 0;
    this.mouthOpen = 0;        // 0 shut .. 1 wide open
    this.fangStain = 0;        // blood on the fangs after a bite, fades over ~2s
    this.dripTimer = 0;        // rate-limits the fang-tip blood drips
    this.blink = Utils.rand(0, 5);
    this.trail = [];
    this.touchSlack = CONFIG.VAMPIRE.fangReach;
    this.volleyDuration = CONFIG.VAMPIRE.bites * CONFIG.VAMPIRE.biteInterval + CONFIG.VAMPIRE.windUp;
  }

  reset(angleDeg = null) {
    super.reset(angleDeg);
    this.releaseGrip();
    this.volley = null;
    this.biteFlash = 0;
    this.fangStain = 0;
    this.dripTimer = 0;
    this.blink = Utils.rand(0, 5);
    this.trail.length = 0;
  }

  setOpponent(other) { this.target = other; }

  get isGripping() { return this.grip !== null; }

  /* -- physics: both fighters are pinned while the vampire is latched on --- */

  update(dt, ctx) {
    super.update(dt, ctx);

    this.updateVolley(dt);

    if (this.biteFlash > 0) this.biteFlash = Math.max(0, this.biteFlash - dt * 3.4);
    if (this.fangStain > 0) this.fangStain = Math.max(0, this.fangStain - dt * 0.5);
    this.mouthOpen = Utils.lerp(this.mouthOpen, this.volley ? 1 : 0, Utils.clamp(dt * 9, 0, 1));
  }

  applyStatusEffects(dt) {
    if (!this.alive || !this.target) return;
    if (this.isGripping) return;   // stays pointed at whatever it is biting
    this.faceTarget(dt);
  }

  /** Vampire always rotates to look at the electricity ball. */
  faceTarget(dt = 0, snap = false) {
    if (!this.target) return;
    const want = Math.atan2(this.target.y - this.y, this.target.x - this.x);
    if (snap) { this.angle = want; return; }
    const d = Utils.angleDelta(this.angle, want);
    this.angle += d * Utils.clamp(dt * 7, 0, 1);
  }

  updateVisuals(dt) {
    this.blink += dt;

    if (this.alive) {
      this.trail.unshift({ x: this.x, y: this.y, a: this.angle });
      if (this.trail.length > 14) this.trail.pop();

      /* blood keeps dripping off the fangs for a moment after a bite */
      this.dripTimer -= dt;
      if (this.fangStain > 0.05 && this.dripTimer <= 0) {
        this.dripTimer = Utils.rand(0.14, 0.32);
        const tip = this.fangTipWorld(Math.random() < 0.5 ? -1 : 1);
        Effects.blood(tip.x, tip.y, 1, { speed: [8, 60], life: [0.5, 0.95], size: [1.6, 3.2] });
      }
    }
  }

  /* -- ability ---------------------------------------------------------- */

  /** Fang contact test — true when the fangs reach into the opponent. */
  fangsTouching(other) {
    if (!this.alive || !other.alive) return false;
    const reach = this.radius + other.radius + CONFIG.VAMPIRE.fangReach;
    if (this.distanceTo(other) > reach) return false;
    const toOther = Math.atan2(other.y - this.y, other.x - this.x);
    return Math.cos(Utils.angleDelta(this.angle, toOther)) > 0.15;
  }

  onTouchOpponent(target) {
    if (!this.alive || !target.alive) return;
    if (this.volley) return;
    if (!this.ready('bite', CONFIG.VAMPIRE.biteCooldown)) return;
    if (!this.fangsTouching(target)) return;
    this.mark('bite');
    this.startBiteVolley(target);
  }

  onContactOpponent(target) {
    /* A direct collision also counts as fang contact. */
    this.onTouchOpponent(target);
    /* While gripping, the pair is held together instead of bouncing apart. */
    return this.isGripping;
  }

  startBiteVolley(target) {
    const cfg = CONFIG.VAMPIRE;
    this.volley = {
      target,
      bitesLeft: cfg.bites,
      timer: cfg.windUp,           // short wind-up so the bite lands after impact
    };
    this.volleyDuration = cfg.bites * cfg.biteInterval + cfg.windUp;
    this.biteFlash = Math.max(this.biteFlash, 0.6);

    /* Grip: freeze BOTH fighters. The vampire has hold of its prey, so it is
       rooted too, and the target is pinned to the vampire's jaws. */
    this.grip = {
      offsetX: target.x - this.x,
      offsetY: target.y - this.y,
    };
    this.applyFreeze('grip', this.volleyDuration);
    target.applyFreeze('grip', this.volleyDuration);

    Effects.ring(this.x, this.y, {
      color: '#ff4d6a', from: this.radius * 0.8, to: this.radius * 1.9, width: 4, life: 0.32,
    });
  }

  /** Release the grip and hand both fighters their original velocity back. */
  releaseGrip() {
    if (!this.grip) return;
    this.grip = null;
    this.clearFreeze('grip');
    if (this.target) this.target.clearFreeze('grip');
  }

  updateVolley(dt) {
    const v = this.volley;
    if (!v) return;
    const cfg = CONFIG.VAMPIRE;
    const target = v.target;

    if (!target.alive) {
      this.volley = null;
      this.releaseGrip();
      return;
    }

    /* Hold the gripped pair together. Both keep their velocities untouched so
       they resume exactly as they were once the bite sequence ends. */
    this.x = target.x - this.grip.offsetX;
    this.y = target.y - this.grip.offsetY;

    v.timer -= dt;
    while (v.timer <= 0 && v.bitesLeft > 0) {
      v.timer += cfg.biteInterval;
      v.bitesLeft--;
      this.landBite(target);
    }
    if (v.bitesLeft <= 0) {
      this.volley = null;
      this.releaseGrip();
    }
  }

  /** A single bite: 25 damage, and the same amount stolen as health. */
  landBite(target) {
    const cfg = CONFIG.VAMPIRE;
    const dealt = target.takeDamage(cfg.biteDamage, this);
    if (dealt <= 0) return;

    this.hitsLanded++;
    const stolen = this.heal(dealt);
    this.biteFlash = 1;
    this.fangStain = 1;

    Effects.popup(target.x, target.y - target.radius - 12, `-${Utils.fmt(dealt)}`, {
      color: '#ff6b7f', size: 26, crit: true,
    });
    if (stolen > 0) {
      Effects.popup(this.x, this.y - this.radius - 12, `+${Utils.fmt(stolen)}`, {
        color: '#6bffa4', size: 22,
      });
    }
    Effects.ring(target.x, target.y, {
      color: '#ff4d6a', from: target.radius * 0.45, to: target.radius * 1.3, width: 3.5, life: 0.28,
    });
    Effects.blood(target.x + Utils.rand(-8, 8), target.y + Utils.rand(-8, 8), 10, {
      dir: Math.atan2(this.y - target.y, this.x - target.x), spread: 1.7,
    });
    Effects.slash(target.x, target.y, Math.atan2(this.y - target.y, this.x - target.x) + Math.PI,
      { color: '#ff5a72', length: this.radius + 20 });
    SFX.bite();
    SFX.heal();
  }

  onWallHit() { /* the vampire has no wall behaviour */ }

  /* -- visuals ---------------------------------------------------------- */

  /** The double-thump of a heartbeat, 0..~1. Drives the inner body glow. */
  static heartbeat(t) {
    const p = (t * 0.8) % 1;
    const thump = (at, w) => {
      const d = (p - at) / w;
      return Math.exp(-d * d);
    };
    return thump(0.1, 0.05) + 0.55 * thump(0.28, 0.06);
  }

  /** Where the two fangs sit and how far they reach. Shared by the drawing
      code and the blood-drip spawner so drips always come off the tips. */
  fangGeometry() {
    const open = this.mouthOpen;
    const r = this.radius;
    return {
      base: r * 0.58,
      jaw: r * Utils.lerp(0.3, 0.52, open),
      len: r * Utils.lerp(0.3, 0.52, open),
      pull: r * Utils.lerp(0.05, 0.34, open),
      root: r * Utils.lerp(0.18, 0.13, open),
    };
  }

  /** World position of one fang tip (sign = +1 / -1 side). */
  fangTipWorld(sign) {
    const g = this.fangGeometry();
    const tx = g.base + g.len;
    const ty = sign * (g.jaw - g.pull);
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: this.x + c * tx - s * ty, y: this.y + s * tx + c * ty };
  }

  drawBody(ctx) {
    const r = this.radius;

    /* cape and ears sit behind the sphere body */
    this.drawCape(ctx, r);
    this.drawEars(ctx, r);

    /* blood-red body with a darker, grittier rim */
    ctx.save();
    ctx.shadowColor = 'rgba(255, 40, 70, 0.7)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = this.sphereGradient(ctx, r, '#ff8b96', '#c8102e', '#4a0713');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 150, 160, 0.6)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    /* slow heartbeat glowing under the skin */
    const beat = VampireBall.heartbeat(this.time);
    ctx.save();
    ctx.globalAlpha = 0.12 + 0.32 * Math.min(1.2, beat);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.92);
    core.addColorStop(0, 'rgba(255, 130, 150, 0.9)');
    core.addColorStop(0.45, 'rgba(210, 30, 60, 0.42)');
    core.addColorStop(1, 'rgba(120, 8, 28, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* glossy specular sheen */
    ctx.save();
    const spec = ctx.createRadialGradient(-r * 0.42, -r * 0.48, r * 0.05, -r * 0.36, -r * 0.42, r * 0.62);
    spec.addColorStop(0, 'rgba(255, 236, 240, 0.5)');
    spec.addColorStop(0.55, 'rgba(255, 200, 210, 0.1)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.98, 0, TAU);
    ctx.fill();
    ctx.restore();

    this.drawHair(ctx, r);
    this.drawFangs(ctx, r);
    this.drawFace(ctx, r);
    this.flashOverlay(ctx, r, 0.55);
  }

  /** Dark cape billowing out behind the vampire (opposite of where it looks). */
  drawCape(ctx, r) {
    const t = this.time;
    const flutter = Math.sin(t * 2.3) * 0.6 + Math.sin(t * 3.9 + 1.4) * 0.4;
    const flare = 1 + 0.1 * flutter;

    const capePath = () => {
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.78);
      ctx.quadraticCurveTo(-r * 1.05, -r * 0.98 * flare, -r * 1.5, -r * 0.62 * flare);
      ctx.quadraticCurveTo(-r * 1.28, -r * 0.28 * flare, -r * 1.62, 0);
      ctx.quadraticCurveTo(-r * 1.28, r * 0.28 * flare, -r * 1.5, r * 0.62 * flare);
      ctx.quadraticCurveTo(-r * 1.05, r * 0.98 * flare, -r * 0.12, r * 0.78);
      ctx.quadraticCurveTo(-r * 0.58, 0, -r * 0.12, -r * 0.78);
      ctx.closePath();
    };

    ctx.save();

    /* outer cloth */
    const cloth = ctx.createLinearGradient(0, 0, -r * 1.7, 0);
    cloth.addColorStop(0, 'rgba(120, 16, 40, 0.95)');
    cloth.addColorStop(0.55, 'rgba(70, 8, 24, 0.55)');
    cloth.addColorStop(1, 'rgba(30, 2, 10, 0)');
    ctx.fillStyle = cloth;
    capePath();
    ctx.fill();

    ctx.restore();
  }

  /** Two pointed bat ears poking out of the sides of the head. */
  drawEars(ctx, r) {
    for (const sign of [-1, 1]) {
      ctx.save();
      ctx.rotate(sign * 2.35);

      ctx.fillStyle = '#20040c';
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.36);
      ctx.quadraticCurveTo(r * 1.08, -r * 0.52, r * 1.5, -r * 0.1);
      ctx.quadraticCurveTo(r * 1.05, r * 0.16, r * 0.5, r * 0.36);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#8c142c';
      ctx.beginPath();
      ctx.moveTo(r * 0.68, -r * 0.2);
      ctx.quadraticCurveTo(r * 1.05, -r * 0.3, r * 1.28, -r * 0.08);
      ctx.quadraticCurveTo(r * 1.0, r * 0.06, r * 0.68, r * 0.18);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  /** Slicked-back hair with a widow's peak over the brow. */
  drawHair(ctx, r) {
    const a = 2.05;
    const rr = r * 0.995;
    const x0 = Math.cos(a) * rr;
    const y0 = Math.sin(a) * rr;

    ctx.save();
    const grad = ctx.createRadialGradient(-r * 0.15, 0, r * 0.15, -r * 0.35, 0, r * 1.15);
    grad.addColorStop(0, '#3c0918');
    grad.addColorStop(1, '#140209');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.arc(0, 0, rr, a, TAU - a);          // outer edge, round the back
    ctx.quadraticCurveTo(-r * 0.5, -y0 * 0.55, -r * 0.05, 0);   // hairline: one
    ctx.quadraticCurveTo(-r * 0.5, y0 * 0.55, x0, y0);          // smooth peak
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawFangs(ctx, r) {
    const open = this.mouthOpen;
    const g = this.fangGeometry();

    /* the mouth: a dark cavity that yawns open mid-bite (kept inside
       the sphere, while the fangs themselves reach past the rim) */
    const mw = r * Utils.lerp(0.26, 0.46, open);
    const mh = r * Utils.lerp(0.08, 0.42, open);
    const cx = g.base + g.len * 0.3;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.985, 0, TAU);
    ctx.clip();

    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(mw / mh, 1);
    const cavity = ctx.createRadialGradient(0, 0, 0, 0, 0, mh);
    cavity.addColorStop(0, '#2a0412');
    cavity.addColorStop(1, '#100108');
    ctx.fillStyle = cavity;
    ctx.beginPath();
    ctx.arc(0, 0, mh, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* a hint of tongue deep in the gape */
    if (open > 0.3) {
      ctx.globalAlpha = (open - 0.3) * 1.3;
      const tongue = ctx.createRadialGradient(cx + mw * 0.1, mh * 0.3, 0, cx + mw * 0.1, mh * 0.3, mh * 0.55);
      tongue.addColorStop(0, '#8c1430');
      tongue.addColorStop(1, 'rgba(120, 16, 40, 0)');
      ctx.fillStyle = tongue;
      ctx.beginPath();
      ctx.ellipse(cx + mw * 0.1, mh * 0.3, mw * 0.42, mh * 0.32, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* curved ivory fangs hooking in toward the prey */
    const stain = this.fangStain;
    for (const sign of [-1, 1]) {
      const tip = { x: g.base + g.len, y: sign * (g.jaw - g.pull) };
      const rootA = { x: g.base - r * 0.02, y: sign * (g.jaw + g.root * 0.6) };
      const rootB = { x: g.base + g.len * 0.28, y: sign * (g.jaw - g.root * 0.6) };

      /* gum the fang is rooted in, so it never floats free of the mouth */
      ctx.save();
      ctx.fillStyle = '#24030e';
      ctx.beginPath();
      ctx.ellipse((rootA.x + rootB.x) / 2, (rootA.y + rootB.y) / 2,
        g.root * 1.35, g.root * 0.95, sign * 0.45, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      if (this.biteFlash > 0) {
        ctx.shadowColor = '#ff4d6a';
        ctx.shadowBlur = 18 * this.biteFlash;
      }

      const ivory = ctx.createLinearGradient(rootA.x, rootA.y, tip.x, tip.y);
      ivory.addColorStop(0, '#e7d3b2');
      ivory.addColorStop(0.55, '#fffdf6');
      ivory.addColorStop(1, '#ffffff');

      ctx.beginPath();
      ctx.moveTo(rootA.x, rootA.y);
      ctx.quadraticCurveTo(g.base + g.len * 0.5, sign * (g.jaw + g.root * 0.85), tip.x, tip.y);
      ctx.lineTo(rootB.x, rootB.y);
      ctx.closePath();
      ctx.fillStyle = ivory;
      ctx.fill();
      ctx.strokeStyle = 'rgba(92, 18, 32, 0.8)';
      ctx.lineWidth = r * 0.035;
      ctx.stroke();
      ctx.restore();

      /* fresh blood clinging to the tip */
      if (stain > 0.01) {
        ctx.save();
        ctx.globalAlpha = stain * 0.85;
        const blood = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, g.len * 0.55);
        blood.addColorStop(0, '#c81f36');
        blood.addColorStop(1, 'rgba(200, 31, 54, 0)');
        ctx.fillStyle = blood;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, g.len * 0.55, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    /* soft crimson-white glow at the jaws while the bite lands */
    if (this.biteFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.biteFlash * 0.55;
      const snap = ctx.createRadialGradient(g.base + g.len * 0.5, 0, 0, g.base + g.len * 0.5, 0, g.len * 1.1);
      snap.addColorStop(0, 'rgba(255, 233, 236, 0.8)');
      snap.addColorStop(1, 'rgba(255, 90, 114, 0)');
      ctx.fillStyle = snap;
      ctx.beginPath();
      ctx.arc(g.base + g.len * 0.5, 0, g.len * 1.1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawFace(ctx, r) {
    /* blink: squash the eyes shut for a moment every few seconds */
    const blinkPhase = this.blink % 4.6;
    const blinking = blinkPhase > 4.45;
    const eyeShut = blinking ? 0.12 : 1;

    for (const sign of [-1, 1]) {
      const ex = r * 0.15;
      const ey = sign * r * 0.38;

      ctx.save();

      /* dark eye socket */
      ctx.fillStyle = '#1c0208';
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.235, r * 0.175, sign * 0.28, 0, TAU);
      ctx.fill();

      /* angry brow ridge, sitting on the outer edge of the socket */
      ctx.strokeStyle = '#2a030c';
      ctx.lineWidth = r * 0.095;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.2, ey + sign * r * 0.2);
      ctx.lineTo(ex + r * 0.2, ey + sign * r * 0.11);
      ctx.stroke();

      /* glowing crimson iris */
      ctx.shadowColor = 'rgba(255, 43, 69, 0.9)';
      ctx.shadowBlur = 12 + this.biteFlash * 20;
      const iris = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 0.15);
      iris.addColorStop(0, '#ff7d92');
      iris.addColorStop(0.55, '#ff2b45');
      iris.addColorStop(1, '#8c0c22');
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.ellipse(ex + r * 0.02, ey, r * 0.15, r * 0.13 * eyeShut, sign * 0.28, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      /* slit pupil, aimed along the direction it is looking */
      ctx.fillStyle = '#12010a';
      ctx.beginPath();
      ctx.ellipse(ex + r * 0.03, ey, r * 0.085, r * 0.04 * eyeShut, 0, 0, TAU);
      ctx.fill();

      /* glint */
      if (!blinking) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(ex + r * 0.075, ey - sign * r * 0.055, r * 0.038, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  drawOverlay(ctx) {
    /* crimson mist wake left behind the vampire */
    if (this.trail.length > 3) {
      ctx.save();
      for (let i = 3; i < this.trail.length; i += 3) {
        const p = this.trail[i];
        const t = 1 - i / this.trail.length;
        const rr = this.radius * (0.5 + 0.55 * t);
        const mist = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        mist.addColorStop(0, `rgba(255, 50, 90, ${0.13 * t})`);
        mist.addColorStop(1, 'rgba(255, 50, 90, 0)');
        ctx.fillStyle = mist;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    /* orbiting blood motes */
    if (!this.alive) return;
    const r = this.radius;
    for (let i = 0; i < 3; i++) {
      const a = this.time * (0.55 + i * 0.12) + i * (TAU / 3);
      const rr = r * (1.1 + 0.15 * Math.sin(this.time * 1.7 + i * 2.2));
      const x = this.x + Math.cos(a) * rr;
      const y = this.y + Math.sin(a) * rr;
      const flicker = 0.45 + 0.55 * Utils.noise(this.time * 2.4 + i * 13.7);
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.4 * flicker;
      ctx.shadowColor = '#ff2d55';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff5c7a';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.055 * (0.8 + 0.4 * flicker), 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}
