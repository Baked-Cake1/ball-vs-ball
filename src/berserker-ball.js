/* =========================================================================
   berserker-ball.js
   ---------------------------------------------------------------------------
   Berserker Ball — an orange bruiser that fights harder the closer it is to
   death. Ability "Last Stand":
     - contact damage like Verity: every touch hurts the opponent
     - the damage is driven entirely by how much health Berserker has LOST:
         full health -> feeble hits (damageFull)
         nearly dead -> devastating hits (damageEmpty)
       and it scales linearly in between
     - no reach, no gimmicks — just a ball you really don't want to hurt
   Visuals: horns, angry brow and gritted teeth, and a body that flushes from
   ember orange to furious red as its health falls (shown live by `ragePct`).
   ========================================================================= */

class BerserkerBall extends Ball {
  constructor(def, opts) {
    super(def, opts);
    this.contactFlash = 0;   // brief flare when it lands a hit
    this.blink = Utils.rand(0, 4);
    this.touchSlack = CONFIG.BERSERKER.touchSlack;
  }

  reset(angleDeg = null) {
    super.reset(angleDeg);
    this.contactFlash = 0;
    this.blink = Utils.rand(0, 4);
  }

  /* -- rage ------------------------------------------------------------- */

  /** 0 = calm at full health, 1 = on its last legs. Drives damage + visuals. */
  get ragePct() { return 1 - this.healthPct; }

  /** Contact damage for the current health: linear from full to empty. */
  get contactDamage() {
    const cfg = CONFIG.BERSERKER;
    return cfg.damageFull + (cfg.damageEmpty - cfg.damageFull) * this.ragePct;
  }

  /* -- ability: contact damage ------------------------------------------ */

  onContactOpponent(target) {
    this.hit(target);
    return false;   // Berserker never holds on — the pair always bounces apart
  }

  onTouchOpponent(target) {
    this.hit(target);
  }

  /** Land a hit, gated by a cooldown so a single collision is not counted
      many times by the physics sub-steps. */
  hit(target, key = 'contact', cooldown = CONFIG.BERSERKER.contactCooldown) {
    if (!this.alive || !target.alive) return;
    if (!this.ready(key, cooldown)) return;

    const factor = key === 'lash' ? CONFIG.BERSERKER.gripLashFactor : 1;
    const damage = this.contactDamage * factor;
    const dealt = target.takeDamage(damage, this);
    if (dealt <= 0) return;

    this.mark(key);
    this.hitsLanded++;
    this.contactFlash = 1;

    const raging = this.ragePct >= 0.5;
    Effects.popup(target.x, target.y - target.radius - 14, `-${Utils.fmt(dealt)}`, {
      color: raging ? '#ff5c3a' : '#ffc24d',
      size: raging ? 32 : 24,
      crit: raging,
    });
    Effects.ring(target.x, target.y, {
      color: raging ? '#ff5c3a' : '#ffb03a',
      from: target.radius, to: target.radius + (raging ? 56 : 30),
      width: raging ? 6 : 4, life: 0.32,
    });
    Effects.sparks(target.x, target.y, raging ? 22 : 10, {
      color: raging ? '#ff8a5c' : '#ffd9a0',
      speed: raging ? [140, 420] : [80, 240],
      life: [0.2, 0.55],
    });
    if (raging) {
      Effects.slash(target.x, target.y, Utils.rand(0, TAU), {
        color: '#ff5c3a', length: target.radius + 26,
      });
      SFX.impact();
    } else {
      SFX.bounce();
    }
  }

  /* -- per-frame -------------------------------------------------------- */

  update(dt, ctx) {
    super.update(dt, ctx);
    this.blink += dt;
    if (this.contactFlash > 0) this.contactFlash = Math.max(0, this.contactFlash - dt * 3.6);

    /* "Last Stand" — grabbed by the vampire, a Berserker lashes out and keeps
       biting for as long as it is held. */
    const held = this.isFrozen && this.frozen && this.frozen.reason === 'grip';
    if (held && this.target) {
      this.hit(this.target, 'lash', CONFIG.BERSERKER.gripLashCooldown);
    }
  }

  updateVisuals() { /* no motion effects — the rage glow is drawn in place */ }

  /* -- visuals ---------------------------------------------------------- */

  drawBody(ctx) {
    const r = this.radius;
    const rage = this.ragePct;

    /* warm ember body — the shadow warms up as rage builds */
    ctx.save();
    ctx.shadowColor = `rgba(255, ${Math.round(120 - 60 * rage)}, 40, ${0.55 + 0.3 * rage})`;
    ctx.shadowBlur = 22 + 18 * rage;
    ctx.fillStyle = this.sphereGradient(ctx, r, '#ffcf7a', '#ff8c2a', '#7a2c00');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.55)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    /* the whole body flushes furious red as health falls */
    if (rage > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.58 * rage;
      const hot = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
      hot.addColorStop(0, '#ff6a20');
      hot.addColorStop(0.6, '#e23400');
      hot.addColorStop(1, '#8c1400');
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.995, 0, TAU);
      ctx.fill();

      /* a furnace-bright rim once it is properly angry */
      if (rage > 0.3) {
        ctx.globalAlpha = (rage - 0.3) * 0.9;
        ctx.strokeStyle = '#ff7a30';
        ctx.lineWidth = r * 0.05;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.94, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* glossy sheen */
    ctx.save();
    const spec = ctx.createRadialGradient(-r * 0.42, -r * 0.48, r * 0.05, -r * 0.36, -r * 0.42, r * 0.62);
    spec.addColorStop(0, 'rgba(255, 244, 224, 0.5)');
    spec.addColorStop(0.55, 'rgba(255, 214, 170, 0.1)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.98, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* horns and face are drawn upright, so undo the body rotation */
    ctx.rotate(-this.angle);
    this.drawHorns(ctx, r);
    this.drawFace(ctx, r, rage);
    this.flashOverlay(ctx, r, 0.6);
  }

  /** Two sharp curved horns at the top of the head. */
  drawHorns(ctx, r) {
    for (const s of [-1, 1]) {
      ctx.save();

      /* tip first, then the two flanks back down to a wide base */
      const tipX = s * r * 0.5, tipY = -r * 1.42;
      const baseInX = s * r * 0.26, baseInY = -r * 0.88;
      const baseOutX = s * r * 0.68, baseOutY = -r * 0.7;

      ctx.fillStyle = '#4a1800';
      ctx.beginPath();
      ctx.moveTo(baseInX, baseInY);
      ctx.lineTo(tipX, tipY);
      ctx.quadraticCurveTo(s * r * 0.62, -r * 1.12, baseOutX, baseOutY);
      ctx.closePath();
      ctx.fill();

      /* hot inner edge */
      ctx.strokeStyle = 'rgba(255, 150, 70, 0.4)';
      ctx.lineWidth = r * 0.03;
      ctx.stroke();

      ctx.restore();
    }
  }

  /** Angry brow, burning eyes, gritted teeth. */
  drawFace(ctx, r, rage) {
    const eyeY = -r * 0.16;
    const eyeX = r * 0.33;
    const eyeR = r * 0.17;

    /* blink: squash the eyes shut for a moment every few seconds */
    const blinkPhase = this.blink % 4.2;
    const blinking = blinkPhase > 4.0;
    const eyeScale = blinking ? 0.12 : 1;

    /* dark sockets with hot irises */
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * eyeX, eyeY);

      ctx.fillStyle = '#2a0c00';
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeR * 1.15, eyeR * 1.05 * eyeScale, 0, 0, TAU);
      ctx.fill();

      if (!blinking) {
        /* the iris burns hotter as rage builds */
        if (rage > 0.3) {
          ctx.shadowColor = '#ff4d1e';
          ctx.shadowBlur = (rage - 0.3) * 26;
        }
        const iris = ctx.createRadialGradient(0, 0, 0, 0, 0, eyeR * 0.8);
        iris.addColorStop(0, '#fff2c8');
        iris.addColorStop(0.5, rage > 0.5 ? '#ff7a1e' : '#ff8a2a');
        iris.addColorStop(1, rage > 0.5 ? '#c22c00' : '#b35a00');
        ctx.fillStyle = iris;
        ctx.beginPath();
        ctx.ellipse(0, 0, eyeR * 0.64, eyeR * 0.58, 0, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(eyeR * 0.24, -eyeR * 0.3, eyeR * 0.18, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    /* heavy angry brows crashing toward the nose — kept clear of the eyes */
    ctx.save();
    ctx.strokeStyle = '#2a0c00';
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * (eyeX + eyeR * 1.75), eyeY - eyeR * 2.05);
      ctx.lineTo(s * (eyeX - eyeR * 1.05), eyeY - eyeR * 0.95);
      ctx.stroke();
    }
    ctx.restore();

    /* gritted teeth: a clenched jaw split into teeth */
    const mw = r * 0.46;
    const mh = r * 0.17;
    const my = r * 0.4;
    ctx.save();
    Utils.roundRect(ctx, -mw, my - mh, mw * 2, mh * 2, mh * 0.55);
    ctx.fillStyle = '#fff3dc';
    ctx.fill();
    ctx.strokeStyle = '#7a2c00';
    ctx.lineWidth = r * 0.04;
    ctx.stroke();

    /* the gaps between the clenched teeth */
    ctx.strokeStyle = '#7a2c00';
    ctx.lineWidth = r * 0.035;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * mw * 0.32, my - mh * 0.88);
      ctx.lineTo(i * mw * 0.32, my + mh * 0.88);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Unrotated overlay: the contact flare and the rage aura. */
  drawOverlay(ctx) {
    const r = this.radius;
    const rage = this.ragePct;

    if (this.contactFlash > 0.001) {
      ctx.save();
      ctx.globalAlpha = this.contactFlash * 0.55;
      ctx.strokeStyle = rage >= 0.5 ? '#ff5c3a' : '#ffd9a0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 4, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    /* a slow, hot pulse around the ball while it is hurting */
    if (this.alive && rage > 0.15) {
      const pulse = 0.7 + 0.3 * Math.sin(this.time * 5);
      ctx.save();
      ctx.globalAlpha = (rage - 0.15) * 0.55 * pulse;
      ctx.strokeStyle = '#ff4d1e';
      ctx.shadowColor = '#ff4d1e';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 7 + 3 * pulse, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
}
