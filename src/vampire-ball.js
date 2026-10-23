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
   ========================================================================= */

class VampireBall extends Ball {
  constructor(def, opts) {
    super(def, opts);
    this.volley = null;        // active bite sequence
    this.grip = null;          // { offsetX, offsetY } while latched on
    this.biteFlash = 0;
    this.mouthOpen = 0;        // 0 shut .. 1 wide open
    this.trail = [];
    this.touchSlack = CONFIG.VAMPIRE.fangReach;
    this.volleyDuration = CONFIG.VAMPIRE.bites * CONFIG.VAMPIRE.biteInterval + CONFIG.VAMPIRE.windUp;
  }

  reset(angleDeg = null) {
    super.reset(angleDeg);
    this.releaseGrip();
    this.volley = null;
    this.biteFlash = 0;
    this.trail.length = 0;
  }

  setOpponent(other) { this.target = other; }

  get isGripping() { return this.grip !== null; }

  /* -- physics: both fighters are pinned while the vampire is latched on --- */

  update(dt, ctx) {
    super.update(dt, ctx);

    this.updateVolley(dt);

    if (this.biteFlash > 0) this.biteFlash = Math.max(0, this.biteFlash - dt * 3.4);
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
    if (this.alive) {
      this.trail.unshift({ x: this.x, y: this.y, a: this.angle });
      if (this.trail.length > 14) this.trail.pop();
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

    Effects.popup(target.x, target.y - target.radius - 12, `-${Utils.fmt(dealt)}`, {
      color: '#ff6b7f', size: 26, crit: true,
    });
    if (stolen > 0) {
      Effects.popup(this.x, this.y - this.radius - 12, `+${Utils.fmt(stolen)}`, {
        color: '#6bffa4', size: 22,
      });
    }
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

  drawBody(ctx) {
    const r = this.radius;

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

    /* the fangs point along +x, which is where the vampire is looking */
    this.drawFangs(ctx, r);
    this.drawFace(ctx, r);
    this.flashOverlay(ctx, r, 0.55);
  }

  drawFangs(ctx, r) {
    const open = this.mouthOpen;
    const jaw = Utils.lerp(0.16, 0.62, open) * r;
    const len = Utils.lerp(0.32, 0.46, open) * r;
    const w = r * 0.17;
    const base = r * 0.62;

    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = this.biteFlash > 0 ? 18 * this.biteFlash : 6;

    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(base, sign * jaw);
      ctx.lineTo(base + len, sign * (jaw + sign * 0.35 * w));
      ctx.lineTo(base + len * 0.55, sign * (jaw + w));
      ctx.closePath();
      ctx.fillStyle = '#fff8f0';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 20, 35, 0.8)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    if (this.biteFlash > 0) {
      ctx.globalAlpha = this.biteFlash;
      ctx.fillStyle = '#ffe9ec';
      ctx.beginPath();
      ctx.arc(base + len * 0.5, 0, w * 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFace(ctx, r) {
    const look = 0.34 * r;
    /* angry eyes */
    for (const sign of [-1, 1]) {
      const ex = r * 0.16;
      const ey = sign * r * 0.36;

      ctx.save();
      ctx.fillStyle = '#2a0208';
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.19, r * 0.15, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#ffea00';
      ctx.beginPath();
      ctx.arc(ex + look * 0.35, ey, r * 0.075, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = '#3a040c';
      ctx.lineWidth = r * 0.075;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.24, ey - sign * r * 0.26);
      ctx.lineTo(ex + r * 0.20, ey - sign * r * 0.10);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawOverlay(ctx) {
    /* dark energy trail behind the vampire, drawn unrotated */
    if (this.trail.length > 3) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#ff2d55';
      ctx.lineCap = 'round';
      for (let i = 2; i < this.trail.length; i += 2) {
        const a = this.trail[i];
        const b = this.trail[i - 2];
        const t = 1 - i / this.trail.length;
        ctx.globalAlpha = 0.3 * t;
        ctx.lineWidth = this.radius * 0.9 * t;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
