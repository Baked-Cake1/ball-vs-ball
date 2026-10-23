/* =========================================================================
   verity-ball.js
   ---------------------------------------------------------------------------
   Verity Ball — a yellow ball with a face, and a temper.
   Ability "Mood Swing":
     - damage is powered purely by contact: every touch hurts the opponent
     - the damage depends entirely on Verity's mood:
         Happy       10 damage   (a friendly smile)
         Displeased  80 damage   (a sullen frown)
         Monsterous 350 damage   (a horror grin, and twice the size)
     - every time Verity TAKES damage there is a 10% chance its mood sours
       one stage further. It never calms back down.
   ========================================================================= */

class VerityBall extends Ball {
  constructor(def, opts) {
    super(def, opts);
    this.stage = 0;            // index into CONFIG.VERITY.stages
    this.transformFlash = 0;   // 0..1 pulse when the mood changes
    this.transformTime = 0;    // counts down through the change animation
    this.contactFlash = 0;     // brief flare when it lands a touch
    this.blink = Utils.rand(0, 4);
    this.touchSlack = CONFIG.VERITY.touchSlack;
    this.lastDamageSource = null;
    this.lastDamageTime = -Infinity;
    this.applyStage(0, true);
  }

  reset(angleDeg = null) {
    super.reset(angleDeg);
    this.transformFlash = 0;
    this.transformTime = 0;
    this.contactFlash = 0;
    this.blink = Utils.rand(0, 4);
    this.lastDamageSource = null;
    this.lastDamageTime = -Infinity;
    this.applyStage(0, true);
  }

  /* -- mood ------------------------------------------------------------- */

  get stageDef() { return CONFIG.VERITY.stages[this.stage]; }

  get stageName() { return this.stageDef.name; }

  get isMonsterous() { return this.stageDef.id === 'monsterous'; }

  /** Contact damage for the current mood. */
  get contactDamage() { return this.stageDef.damage; }

  /** Push the mood (and everything that follows from it) into the fighter. */
  applyStage(index, instant = false) {
    const stages = CONFIG.VERITY.stages;
    this.stage = Utils.clamp(index, 0, stages.length - 1);
    const def = stages[this.stage];

    /* Monsterous is twice the size. The arena reads `radius` live for walls,
       collisions and the physics sub-step, so this is all that is needed. */
    this.setRadius(this.baseRadius * def.scale);

    if (!instant) {
      this.transformFlash = 1;
      this.transformTime = CONFIG.VERITY.transformTime;
    }
  }

  /** Sour the mood by one stage. Returns true if it actually changed. */
  transform() {
    if (this.stage >= CONFIG.VERITY.stages.length - 1) return false;
    this.applyStage(this.stage + 1);
    this.mark('transform');

    const def = this.stageDef;
    Effects.ring(this.x, this.y, {
      color: def.id === 'monsterous' ? '#ff2d55' : '#ffb020',
      from: this.radius * 0.6, to: this.radius * 2.1, width: 6, life: 0.5,
    });
    Effects.sparks(this.x, this.y, 30, {
      color: def.id === 'monsterous' ? '#ff5c7a' : '#ffe08a',
      speed: [140, 460], life: [0.25, 0.7],
    });
    Effects.popup(this.x, this.y - this.radius - 18, def.name.toUpperCase(), {
      color: def.id === 'monsterous' ? '#ff5c7a' : '#ffd166', size: 30, crit: true,
    });
    SFX.transform();
    return true;
  }

  /** Every hit Verity takes is a chance to lose its temper.
      Damage that arrives in a rapid burst from the same attacker (an
      electricity DoT, say) counts as a single damage event, so the dice are
      rolled once per attack instead of once per frame. */
  onDamaged(amount, source) {
    if (!this.alive || amount <= 0) return;
    if (this.stage >= CONFIG.VERITY.stages.length - 1) return;

    const now = this.time;
    const sameEvent = source !== null
      && source === this.lastDamageSource
      && now - this.lastDamageTime < CONFIG.VERITY.damageEventWindow;
    this.lastDamageSource = source;
    this.lastDamageTime = now;
    if (sameEvent) return;

    if (!this.ready('transform', CONFIG.VERITY.transformLockout)) return;
    if (Math.random() >= CONFIG.VERITY.transformChance) return;
    this.transform();
  }

  /* -- ability: contact damage ------------------------------------------ */

  onContactOpponent(target) {
    this.hit(target);
    return false;   // Verity never holds on — the pair always bounces apart
  }

  onTouchOpponent(target) {
    this.hit(target);
  }

  /** Land a contact hit, gated by the mood's own short cooldown so a single
      collision cannot be counted many times by the physics sub-steps. */
  hit(target) {
    if (!this.alive || !target.alive) return;
    if (!this.ready('contact', this.stageDef.contactCooldown)) return;

    const damage = this.contactDamage;
    const dealt = target.takeDamage(damage, this);
    if (dealt <= 0) return;

    this.mark('contact');
    this.hitsLanded++;
    this.contactFlash = 1;

    const monster = this.isMonsterous;
    Effects.popup(target.x, target.y - target.radius - 14, `-${Utils.fmt(dealt)}`, {
      color: monster ? '#ff5c7a' : '#ffe08a',
      size: monster ? 40 : 26,
      crit: monster,
    });
    Effects.ring(target.x, target.y, {
      color: monster ? '#ff2d55' : '#ffd166',
      from: target.radius, to: target.radius + (monster ? 70 : 34),
      width: monster ? 7 : 4, life: 0.35,
    });
    Effects.sparks(target.x, target.y, monster ? 34 : 12, {
      color: monster ? '#ff8fa3' : '#fff3c4',
      speed: monster ? [160, 520] : [90, 260],
      life: [0.2, 0.6],
    });
    if (monster) {
      Effects.slash(target.x, target.y, Utils.rand(0, TAU), {
        color: '#ff2d55', length: target.radius + 34,
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
    if (this.transformFlash > 0) this.transformFlash = Math.max(0, this.transformFlash - dt * 2.2);
    if (this.transformTime > 0) this.transformTime = Math.max(0, this.transformTime - dt);
    if (this.contactFlash > 0) this.contactFlash = Math.max(0, this.contactFlash - dt * 3.6);
  }

  updateVisuals(dt) {
    /* a slow, menacing spin once it turns monsterous */
    if (this.alive && this.isMonsterous) this.angle += dt * 0.9;
  }

  /* -- visuals ---------------------------------------------------------- */

  drawBody(ctx) {
    const r = this.radius;
    const monster = this.isMonsterous;
    const displeased = this.stageDef.id === 'displeased';

    /* the body colour sours along with the mood */
    const light = monster ? '#ffe066' : '#fff6b0';
    const base = monster ? '#f5b800' : '#ffd93b';
    const dark = monster ? '#8a5a00' : '#c99a00';

    ctx.save();
    ctx.shadowColor = monster ? 'rgba(255, 60, 90, 0.75)' : 'rgba(255, 210, 60, 0.6)';
    ctx.shadowBlur = monster ? 34 : 22;
    ctx.fillStyle = this.sphereGradient(ctx, r, light, base, dark);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    /* rim */
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.strokeStyle = monster ? 'rgba(120, 10, 30, 0.85)' : 'rgba(150, 110, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, r - ctx.lineWidth * 0.5, 0, TAU);
    ctx.stroke();

    /* the face is drawn upright, so undo the body rotation */
    ctx.rotate(-this.angle);
    this.drawFace(ctx, r, monster, displeased);

    ctx.restore();
  }

  /** Happy smile, sullen frown, or a horror grin. */
  drawFace(ctx, r, monster, displeased) {
    const eyeY = -r * 0.22;
    const eyeX = r * 0.34;
    const eyeR = r * (monster ? 0.17 : 0.13);

    /* blink: squash the eyes shut for a moment every few seconds */
    const blinkPhase = this.blink % 4.2;
    const blinking = blinkPhase > 4.0;
    const eyeScale = blinking ? 0.12 : 1;

    ctx.save();
    ctx.fillStyle = monster ? '#2a0008' : '#3a2a00';

    if (monster) {
      /* angry, slanted eyes with glowing crimson irises */
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * eyeX, eyeY);
        ctx.rotate(s * 0.38);

        /* dark socket */
        ctx.fillStyle = '#2a0008';
        ctx.beginPath();
        ctx.ellipse(0, 0, eyeR * 1.35, eyeR * 1.05 * eyeScale, 0, 0, TAU);
        ctx.fill();

        /* hot red iris */
        const iris = ctx.createRadialGradient(0, 0, eyeR * 0.08, 0, 0, eyeR * 0.95);
        iris.addColorStop(0, '#ff8fa3');
        iris.addColorStop(0.55, '#ff2d55');
        iris.addColorStop(1, '#7a0a1e');
        ctx.fillStyle = iris;
        ctx.beginPath();
        ctx.ellipse(0, 0, eyeR * 0.8, eyeR * 0.62 * eyeScale, 0, 0, TAU);
        ctx.fill();

        /* slit pupil */
        ctx.fillStyle = '#180006';
        ctx.beginPath();
        ctx.ellipse(0, 0, eyeR * 0.28, eyeR * 0.52 * eyeScale, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      /* a hot glint in each eye */
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * eyeX + eyeR * 0.32, eyeY - eyeR * 0.34, eyeR * 0.2, 0, TAU);
        ctx.fill();
      }

      /* heavy angry brows, crashing down toward the nose */
      ctx.strokeStyle = '#2a0008';
      ctx.lineWidth = r * 0.115;
      ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * (eyeX + eyeR * 1.55), eyeY - eyeR * 1.5);
        ctx.lineTo(s * (eyeX - eyeR * 0.85), eyeY - eyeR * 0.55);
        ctx.stroke();
      }
    } else {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * eyeX, eyeY, eyeR, eyeR * eyeScale, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    /* mouth */
    const mouthY = r * 0.3;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.5, r * (monster ? 0.11 : 0.085));
    ctx.strokeStyle = monster ? '#2a0008' : '#3a2a00';

    if (monster) {
      /* a wide, jagged horror grin — clipped so the teeth can never poke
         outside the head */
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.985, 0, TAU);
      ctx.clip();

      const w = r * 0.62;          // half-width of the grin
      const topY = r * 0.14;       // lip height at the corners
      const botY = r * 0.24;
      const topMid = r * 0.42;     // lip sag at the centre
      const botMid = r * 0.82;
      const topCtrl = 2 * topMid - topY;
      const botCtrl = 2 * botMid - botY;

      /* points on the two lips (quadratic from -w to +w) */
      const topCurve = (t) => ({
        x: (1 - t) * (1 - t) * -w + t * t * w,
        y: (1 - t) * (1 - t) * topY + 2 * (1 - t) * t * topCtrl + t * t * topY,
      });
      const botCurve = (t) => ({
        x: (1 - t) * (1 - t) * -w + t * t * w,
        y: (1 - t) * (1 - t) * botY + 2 * (1 - t) * t * botCtrl + t * t * botY,
      });

      /* dark interior */
      ctx.beginPath();
      ctx.moveTo(-w, topY);
      ctx.quadraticCurveTo(0, topCtrl, w, topY);
      ctx.lineTo(w, botY);
      ctx.quadraticCurveTo(0, botCtrl, -w, botY);
      ctx.closePath();
      ctx.fillStyle = '#2a0008';
      ctx.fill();

      /* interlocking zigzag teeth, sized to the local gap between the lips */
      const N = 6;
      const depth = (t) => {
        const gap = botCurve(t).y - topCurve(t).y;
        return gap * (0.42 + 0.06 * Math.sin(Math.PI * t));
      };
      ctx.fillStyle = '#fff8e0';
      ctx.strokeStyle = 'rgba(70, 8, 18, 0.5)';
      ctx.lineWidth = r * 0.02;

      /* top row: teeth hanging down from the upper lip */
      for (let i = 0; i < N; i++) {
        const t0 = i / N;
        const t1 = (i + 0.5) / N;
        const t2 = (i + 1) / N;
        const a = topCurve(t0);
        const apex = topCurve(t1);
        const b = topCurve(t2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(apex.x, apex.y + depth(t1));
        ctx.lineTo(b.x, b.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      /* bottom row: offset half a tooth so the rows interlock */
      for (let i = 0; i < N - 1; i++) {
        const t0 = (i + 0.5) / N;
        const t1 = (i + 1) / N;
        const t2 = (i + 1.5) / N;
        const a = botCurve(t0);
        const apex = botCurve(t1);
        const b = botCurve(t2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(apex.x, apex.y - depth(t1));
        ctx.lineTo(b.x, b.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    } else if (displeased) {
      /* a sullen frown */
      const w = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(-w, mouthY + r * 0.14);
      ctx.quadraticCurveTo(0, mouthY - r * 0.22, w, mouthY + r * 0.14);
      ctx.stroke();
    } else {
      /* a friendly smile */
      const w = r * 0.48;
      ctx.beginPath();
      ctx.moveTo(-w, mouthY - r * 0.06);
      ctx.quadraticCurveTo(0, mouthY + r * 0.34, w, mouthY - r * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Unrotated overlay: the mood-change pulse and the contact flare. */
  drawOverlay(ctx) {
    const r = this.radius;

    if (this.transformFlash > 0.001) {
      const t = 1 - this.transformFlash;
      ctx.save();
      ctx.globalAlpha = this.transformFlash * 0.9;
      ctx.strokeStyle = this.isMonsterous ? '#ff2d55' : '#ffd166';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 10 + t * 46, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (this.contactFlash > 0.001) {
      ctx.save();
      ctx.globalAlpha = this.contactFlash * 0.55;
      ctx.strokeStyle = this.isMonsterous ? '#ff5c7a' : '#fff3c4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 4, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
}
