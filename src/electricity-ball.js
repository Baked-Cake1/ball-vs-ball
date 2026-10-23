/* =========================================================================
   electricity-ball.js
   ---------------------------------------------------------------------------
   Electricity Ball — a blue ball with a lighter (cyan) lightning bolt.
   Ability "High Voltage":
     - on contact the opponent is electrocuted for 50 damage immediately
     - and keeps taking damage for 3 seconds, 100 damage spread across it
       (so a full shock = 150 damage total)
     - the opponent is STUNNED in place for those 3 seconds, then its
       velocity is handed straight back and it carries on unchanged
     - the ability then needs 8 seconds to recharge. While recharging the
       ball still bounces off the opponent but deals no damage and no stun.
   ========================================================================= */

class ElectricityBall extends Ball {
  constructor(def, opts) {
    super(def, opts);
    this.shocks = [];          // active DoTs owned by this fighter
    this.boltPhase = Utils.rand(0, 10);
    this.rechargeLeft = 0;     // seconds until the next shock is available
    this.emptyFlash = 0;       // brief visual "nothing happened" pulse
  }

  reset(angleDeg = null) {
    super.reset(angleDeg);
    this.shocks.length = 0;
    this.touchSlack = CONFIG.ELECTRICITY.touchSlack;
    this.rechargeLeft = 0;
    this.emptyFlash = 0;
  }

  /* -- recharge state --------------------------------------------------- */

  get isCharged() { return this.rechargeLeft <= 0; }

  /** 1 = fully charged, 0 = just fired. */
  get chargePct() {
    return 1 - Utils.clamp(this.rechargeLeft / CONFIG.ELECTRICITY.recharge, 0, 1);
  }

  /* -- ability ---------------------------------------------------------- */

  /** Collision with the opponent always counts as an electrocution attempt. */
  onContactOpponent(target) {
    this.shock(target);
    /* A charged hit roots the target, so no bounce is applied to it — the
       lightning holds it exactly where it was struck. */
    return !this.isCharged ? false : target.isFrozen;
  }

  /** Any touch inside the ability's reach also electrocutes. */
  onTouchOpponent(target) {
    this.shock(target);
  }

  shock(target) {
    if (!this.alive || !target.alive) return;

    /* Still recharging: the contact happens, but nothing else does. */
    if (!this.isCharged) {
      if (this.emptyFlash <= 0) this.emptyFlash = 0.45;
      return;
    }

    /* A target that is already stunned cannot be shocked again, and there is
       a short grace window after a stun ends so a single collision cannot both
       end the stun and immediately re-apply it. Either way the charge is kept. */
    if (target.contactImmune) return;

    this.rechargeLeft = CONFIG.ELECTRICITY.recharge;

    const cfg = CONFIG.ELECTRICITY;
    const dealt = target.takeDamage(cfg.impact, this);
    if (dealt <= 0) return;

    this.hitsLanded++;
    Effects.popup(target.x, target.y - target.radius - 14, `-${Utils.fmt(dealt)}`, {
      color: '#9fe8ff', size: 30, crit: true,
    });
    Effects.ring(target.x, target.y, {
      color: '#7df9ff', from: target.radius, to: target.radius + 46, width: 5, life: 0.4,
    });
    Effects.sparks(target.x, target.y, 26, { color: '#bffcff', speed: [120, 420], life: [0.2, 0.6] });
    for (let i = 0; i < 5; i++) {
      Effects.arc(target.x, target.y, Utils.rand(30, 62), { color: '#d8feff', width: 2.6, life: 0.2 });
    }
    SFX.zap();

    this.applyShock(target);
  }

  applyShock(target) {
    const cfg = CONFIG.ELECTRICITY;

    /* Stun: the target is rooted for the full DoT, keeping its velocity. */
    target.applyFreeze('shock', cfg.dotDuration);

    const existing = this.shocks.find((s) => s.target === target);
    if (existing) {
      // Refreshing a shock tops the DoT back up instead of stacking forever.
      existing.remaining = Math.min(cfg.dotTotal, existing.remaining + cfg.dotTotal * 0.5);
      existing.timeLeft = cfg.dotDuration;
      return;
    }
    target.status.shock = { source: this, timeLeft: cfg.dotDuration, duration: cfg.dotDuration };
    this.shocks.push({
      target,
      remaining: cfg.dotTotal,
      timeLeft: cfg.dotDuration,
      popAcc: 0,
      popDamage: 0,
      arcTimer: 0,
      seed: Utils.rand(0, 1000),
    });
  }

  /* -- per-frame DoT ---------------------------------------------------- */

  update(dt, ctx) {
    super.update(dt, ctx);
    this.boltPhase += dt * 8;

    if (this.rechargeLeft > 0) this.rechargeLeft = Math.max(0, this.rechargeLeft - dt);
    if (this.emptyFlash > 0) this.emptyFlash = Math.max(0, this.emptyFlash - dt * 2.4);

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      const target = s.target;

      if (!target.alive || s.timeLeft <= 0 || s.remaining <= 0) {
        if (target.status.shock && target.status.shock.source === this) target.status.shock = null;
        /* Release only the stun hold — a vampire grip on the same target must
           survive the shock wearing off. */
        target.clearFreeze('shock');
        this.shocks.splice(i, 1);
        continue;
      }

      const step = Math.min(dt, s.timeLeft);
      s.timeLeft = Math.max(0, s.timeLeft - dt);

      const dps = CONFIG.ELECTRICITY.dotTotal / CONFIG.ELECTRICITY.dotDuration;
      const want = dps * step;
      const chunk = Math.min(want, s.remaining);
      const dealt = target.takeDamage(chunk, this);
      s.remaining -= chunk;
      s.popDamage += dealt;
      s.popAcc += dt;
      s.arcTimer -= dt;

      if (s.arcTimer <= 0) {
        s.arcTimer = Utils.rand(0.05, 0.13);
        const r = target.radius;
        const a = Utils.rand(0, TAU);
        const px = target.x + Math.cos(a) * r * 0.75;
        const py = target.y + Math.sin(a) * r * 0.75;
        Effects.arc(px, py, Utils.rand(24, 54), {
          color: Math.random() < 0.5 ? '#e8ffff' : '#8ce9ff',
          width: Utils.rand(1.6, 3.1),
          angle: Utils.rand(0, TAU),
          life: Utils.rand(0.1, 0.2),
          branches: Utils.randInt(1, 3),
        });
        if (Math.random() < 0.4) SFX.crackle();
      }

      // Continuous damage is shown as a tidy number every half second.
      if (s.popAcc >= 0.5 || s.remaining <= 0.01) {
        const shown = Utils.fmt(s.popDamage);
        if (Number(shown) > 0) {
          Effects.popup(target.x + Utils.rand(-12, 12), target.y - target.radius - 6, shown, {
            color: '#a9ecff', size: 22,
          });
        }
        s.popAcc = 0;
        s.popDamage = 0;
      }

      if (s.remaining <= 0.01 || s.timeLeft <= 0) {
        if (target.status.shock && target.status.shock.source === this) target.status.shock = null;
        if (target.frozen && target.frozen.reason === 'shock') target.clearFreeze('shock');
        this.shocks.splice(i, 1);
      }
    }
  }

  applyStatusEffects(dt, ctx) {
    super.applyStatusEffects(dt, ctx);
    /* The shock listing stays valid even if the target dies mid-DoT, but the
       stun must not outlive a dead target. */
    for (const s of this.shocks) {
      if (!s.target.alive) {
        s.timeLeft = Math.min(s.timeLeft, 0.25);
        if (s.target.frozen && s.target.frozen.reason === 'shock') s.target.clearFreeze('shock');
      }
    }
  }

  /* -- visuals ---------------------------------------------------------- */

  drawBody(ctx) {
    const r = this.radius;
    const t = this.time;

    ctx.save();
    ctx.shadowColor = 'rgba(70, 190, 255, 0.75)';
    ctx.shadowBlur = 26;

    ctx.fillStyle = this.sphereGradient(ctx, r, '#7fd8ff', '#1e6ff0', '#0a1e63');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(180, 240, 255, 0.85)';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    /* inner electric core */
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.save();
    ctx.globalAlpha = 0.35 + pulse * 0.3;
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
    core.addColorStop(0, 'rgba(210, 250, 255, 0.95)');
    core.addColorStop(1, 'rgba(120, 220, 255, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, TAU);
    ctx.fill();
    ctx.restore();

    this.drawBolt(ctx, r);
    this.drawSparks(ctx, r);
    this.drawRechargeRing(ctx, r);
    this.flashOverlay(ctx, r, 0.7);
    ctx.restore();
  }

  /** A ring that sweeps around the ball while the ability is recharging. */
  drawRechargeRing(ctx, r) {
    const charged = this.isCharged;
    if (charged && this.emptyFlash <= 0) return;

    const rr = r + 7;
    ctx.save();

    if (charged) {
      /* the ball is ready again — a quick confirming pulse */
      ctx.globalAlpha = this.emptyFlash * 1.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#9beeff';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, 0, rr + (1 - this.emptyFlash) * 6, 0, TAU);
      ctx.stroke();
      ctx.restore();
      return;
    }

    /* dim full ring so the "empty" state is legible at a glance */
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#7fd8ff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.stroke();

    /* bright arc sweeping as the charge builds back up */
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#d9fbff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#9beeff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + TAU * this.chargePct);
    ctx.stroke();
    ctx.restore();
  }

  /** The signature lightning bolt, in a lighter shade of blue (cyan/teal). */
  drawBolt(ctx, r) {
    const s = r * 1.5;
    const bolt = (scale, alpha, color, glow) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 16; }
      ctx.beginPath();
      // classic zig-zag bolt, centred in the ball
      ctx.moveTo(0.06 * s, -0.52 * s);
      ctx.lineTo(-0.26 * s, 0.06 * s);
      ctx.lineTo(-0.02 * s, 0.06 * s);
      ctx.lineTo(-0.12 * s, 0.54 * s);
      ctx.lineTo(0.28 * s, -0.04 * s);
      ctx.lineTo(0.02 * s, -0.04 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    bolt(1.08, 0.55, '#39d9ff', '#39d9ff');   // outer glow
    bolt(1.0, 1.0, '#c8fbff', '#8ff0ff');    // bright cyan bolt
  }

  /** Tiny idle crackles orbiting the surface. */
  drawSparks(ctx, r) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = this.boltPhase * 0.6 + (i / n) * TAU;
      const rr = r * (0.78 + 0.16 * Math.sin(this.time * 5 + i * 2));
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 9 + i);
      ctx.strokeStyle = '#d6fbff';
      ctx.lineWidth = 1.8;
      ctx.shadowColor = '#9beeff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a + 1.1) * 9, y + Math.sin(a + 1.1) * 9);
      ctx.lineTo(x + Math.cos(a + 0.2) * 15, y + Math.sin(a + 0.2) * 15);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawOverlay() { /* the shock aura is drawn by the arena/effects layer */ }
}
