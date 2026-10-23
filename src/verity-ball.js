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
      /* angry, slanted eyes */
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * eyeX, eyeY);
        ctx.rotate(s * 0.42);
        ctx.beginPath();
        ctx.ellipse(0, 0, eyeR * 1.25, eyeR * 0.85 * eyeScale, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      /* a hot glint in each eye */
      ctx.fillStyle = '#ff2d55';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * eyeX, eyeY, eyeR * 0.34, 0, TAU);
        ctx.fill();
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
      /* a wide, jagged horror grin filled with teeth */
      const w = r * 0.72;
      const h = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(-w, mouthY - h * 0.25);
      ctx.quadraticCurveTo(0, mouthY + h * 1.15, w, mouthY - h * 0.25);
      ctx.closePath();
      ctx.fillStyle = '#2a0008';
      ctx.fill();

      /* teeth: a row of triangles along the top and bottom of the grin */
      ctx.fillStyle = '#fff8e0';
      const teeth = 6;
      for (let i = 0; i < teeth; i++) {
        const t0 = i / teeth;
        const t1 = (i + 0.5) / teeth;
        const t2 = (i + 1) / teeth;
        const px = (t) => -w + 2 * w * t;
        const py = (t) => mouthY - h * 0.25 + (h * 1.15) * (1 - Math.pow(2 * t - 1, 2)) * 0.5;
        /* upper fang */
        ctx.beginPath();
        ctx.moveTo(px(t0), py(t0));
        ctx.lineTo(px(t1), py(t1) + h * 0.34);
        ctx.lineTo(px(t2), py(t2));
        ctx.closePath();
        ctx.fill();
        /* lower fang */
        ctx.beginPath();
        ctx.moveTo(px(t0), py(t0) + h * 0.62);
        ctx.lineTo(px(t1), py(t1) + h * 0.28);
        ctx.lineTo(px(t2), py(t2) + h * 0.62);
        ctx.closePath();
        ctx.fill();
      }
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
