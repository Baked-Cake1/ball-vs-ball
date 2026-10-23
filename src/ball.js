/* =========================================================================
   ball.js — the shared fighter: physics body, health, damage pipeline and
   all of the status-effect hooks that abilities build on top of.
   ========================================================================= */

class Ball {
  constructor(def, opts = {}) {
    this.def = def;

    this.radius = def.radius ?? CONFIG.BALL.radius;
    this.baseRadius = this.radius;   // abilities may scale this (Verity's moods)
    this.maxHealth = def.maxHealth ?? CONFIG.HEALTH.max;
    this.health = this.maxHealth;

    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = CONFIG.BALL.baseSpeed;

    this.homeX = opts.homeX ?? 0;
    this.homeY = opts.homeY ?? CONFIG.WORLD / 2;
    this.facing = opts.facing ?? 1;   // +1 enters from the left, -1 from the right
    this.angle = this.facing > 0 ? 0 : Math.PI;   // bolt/fangs point at the enemy

    this.color = def.color;
    this.accent = def.accent;

    this.isDead = false;
    this.alive = true;

    this.damageDealt = 0;
    this.damageTaken = 0;
    this.healed = 0;
    this.hitsLanded = 0;

    /* transient, refilled every frame by the abilities */
    this.status = {
      shock: null,      // Electricity DoT state
      bites: null,      // pending Vampire bite volleys
    };

    this.flash = 0;         // white hit flash 0..1
    this.wallFlash = 0;     // rim flash when bouncing off a wall
    this.ghostHealth = this.maxHealth;   // lagging bar behind the real health
    this.touchSlack = 0;    // extra reach an ability may claim (vampire fangs)
    this.side = 'left';

    /* A frozen fighter cannot move, but its velocity is preserved and handed
       straight back the instant the freeze ends. */
    this.frozen = null;     // { reason, timeLeft, duration } or null
    this.frozenSince = 0;   // seconds since the last freeze ended (grace window)

    /* while `kinematic` is set the arena drives the position directly and
       skips normal motion and collision resolution (the vampire's grip). */
    this.kinematic = false;
    this.target = null;     // the opponent, for abilities that track it

    this.cooldowns = {};
    this.time = Utils.rand(0, 10);
  }

  /* -- geometry --------------------------------------------------------- */

  get pos() { return { x: this.x, y: this.y }; }

  get healthPct() { return Utils.clamp(this.health / this.maxHealth, 0, 1); }

  get isFrozen() { return this.frozen !== null; }

  /** Abilities can grow or shrink a fighter (Verity's monsterous stage). */
  setRadius(r) {
    this.radius = Math.max(4, r);
  }

  distanceTo(other) { return Utils.dist(this.x, this.y, other.x, other.y); }

  /* -- lifecycle -------------------------------------------------------- */

  reset(angleDeg = null) {
    this.health = this.maxHealth;
    this.ghostHealth = this.maxHealth;
    this.isDead = false;
    this.alive = true;
    this.flash = 0;
    this.wallFlash = 0;
    this.angle = this.facing > 0 ? 0 : Math.PI;
    this.status.shock = null;
    this.status.bites = null;
    this.frozen = null;
    this.frozenSince = 0;
    this.kinematic = false;
    this.cooldowns = {};
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.healed = 0;
    this.hitsLanded = 0;
    this.launch(angleDeg === null ? Utils.rand(0, 360) : angleDeg);
  }

  /** Send the ball off in a random direction at its constant speed. */
  launch(angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    this.vx = Math.cos(a) * this.speed;
    this.vy = Math.sin(a) * this.speed;
  }

  /** Velocity never decays — this pins the magnitude back to the base speed.
      Direction is the only thing that ever changes. */
  normalizeSpeed() {
    const mag = Math.hypot(this.vx, this.vy);
    if (mag < 0.0001) { this.launch(Utils.rand(0, 360)); return; }
    this.vx = (this.vx / mag) * this.speed;
    this.vy = (this.vy / mag) * this.speed;
  }

  /* -- freeze / stun ---------------------------------------------------- */

  /** Freeze the fighter in place, preserving its velocity for later.
      A fighter can be held by more than one thing at once (a shock stun and a
      vampire grip, say), so the reasons are tracked as a set. The freeze only
      ends once every reason has been released, and `reason` reports the
      strongest one currently in play. */
  applyFreeze(reason, duration) {
    if (!this.alive) return;

    if (this.frozen) {
      /* Re-freezing extends the timer instead of restarting it. */
      this.frozen.reasons.add(reason);
      this.frozen.reason = Ball.dominantFreeze(this.frozen.reasons);
      this.frozen.duration = Math.max(this.frozen.duration, duration);
      this.frozen.timeLeft = Math.max(this.frozen.timeLeft, duration);
      return;
    }

    this.frozen = {
      reasons: new Set([reason]),
      reason,
      timeLeft: duration,
      duration,
    };
    this.frozenSince = 0;
  }

  /** Grip outranks a stun: being latched onto is the more specific state. */
  static dominantFreeze(reasons) {
    return reasons.has('grip') ? 'grip' : [...reasons][0];
  }

  /** End the freeze. The stored velocity is restored completely untouched.
      Passing a reason releases only that hold; the fighter stays frozen if
      anything else is still holding it. */
  clearFreeze(reason = null) {
    if (!this.frozen) return;

    if (reason) {
      this.frozen.reasons.delete(reason);
      if (this.frozen.reasons.size > 0) {
        this.frozen.reason = Ball.dominantFreeze(this.frozen.reasons);
        return;
      }
    }

    this.frozen = null;
    this.frozenSince = 0;
    this.normalizeSpeed();
  }

  /** Should this fighter let an incoming contact hit connect right now? */
  get contactImmune() {
    return this.isFrozen || this.frozenSince < CONFIG.ELECTRICITY.stunGrace;
  }

  /** Random direction that at least has a vertical component, so the balls
      rarely settle into a perfectly horizontal back-and-forth. */
  static randomLaunchAngle() {
    const magnitude = Utils.rand(22, 68);          // degrees off horizontal
    const sign = Math.random() < 0.5 ? -1 : 1;
    const horizontal = Math.random() < 0.5 ? 180 : 0;
    return horizontal + sign * magnitude;
  }

  /* -- damage / healing ------------------------------------------------- */

  takeDamage(amount, source = null) {
    if (!this.alive || amount <= 0) return 0;

    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    const dealt = before - this.health;

    this.damageTaken += dealt;
    this.flash = 1;
    if (source) source.damageDealt += dealt;

    /* Abilities may react to being hurt (Verity's mood swings). */
    this.onDamaged(dealt, source);

    if (this.health <= 0) this.kill();
    return dealt;
  }

  heal(amount) {
    if (!this.alive || amount <= 0) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    const gained = this.health - before;
    this.healed += gained;
    return gained;
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.isDead = true;
    this.vx = 0;
    this.vy = 0;
    this.frozen = null;
    this.kinematic = false;
  }

  /* -- cooldowns -------------------------------------------------------- */

  ready(key, duration) {
    const t = this.cooldowns[key] ?? -Infinity;
    return this.time - t >= duration;
  }

  mark(key) { this.cooldowns[key] = this.time; }

  /* -- per-frame -------------------------------------------------------- */

  update(dt, ctx) {
    this.time += dt;

    if (this.alive) {
      /* A frozen fighter is held in place — its velocity is preserved
         untouched and resumes the moment the freeze ends. A kinematic
         fighter has its position driven by the arena instead. */
      if (!this.isFrozen && !this.kinematic) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        /* the defining rule of the arena: velocity never decays, the speed is
           always exactly the fighter's speed — only the direction changes. */
        this.normalizeSpeed();
      }

      if (this.frozen) {
        this.frozen.timeLeft -= dt;
        if (this.frozen.timeLeft <= 0) this.clearFreeze();
      } else {
        this.frozenSince += dt;
      }
    }

    this.applyStatusEffects(dt, ctx);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4.2);
    if (this.wallFlash > 0) this.wallFlash = Math.max(0, this.wallFlash - dt * 3.2);

    /* the health bar's pale "chunk" eases down after each hit */
    if (this.ghostHealth > this.health) {
      this.ghostHealth = Math.max(this.health, this.ghostHealth - this.maxHealth * dt * 0.9);
    } else {
      this.ghostHealth = this.health;
    }

    this.updateVisuals(dt, ctx);
  }

  applyStatusEffects() { /* abilities override */ }
  updateVisuals() { /* abilities override */ }
  onWallHit() { /* abilities override */ }

  /** Fired on the exact frame this ball collides with its opponent.
      Return `true` to let the arena skip the elastic bounce response. */
  onContactOpponent() { return false; }

  /** Fired every frame the opponent is inside the ability's reach. */
  onTouchOpponent() { /* abilities override */ }

  /** Fired after this fighter actually loses health. */
  onDamaged() { /* abilities override */ }

  /* -- rendering -------------------------------------------------------- */

  drawShadow(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x + 4, this.y + this.radius * 0.72,
      this.radius * 0.92, this.radius * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    this.drawBody(ctx);

    if (this.wallFlash > 0.001) {
      ctx.globalAlpha = this.wallFlash * 0.75;
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 4;
      ctx.shadowColor = this.accent;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius - 2, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    this.drawOverlay(ctx);
  }

  drawBody(ctx) {
    /* subclass */
  }

  drawOverlay() { /* subclass, drawn unrotated on top */ }

  /* -- helpers used by subclasses --------------------------------------- */

  /** Radial-gradient sphere shading for a given base colour. */
  sphereGradient(ctx, r, light, base, dark) {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.12, 0, 0, r);
    g.addColorStop(0, light);
    g.addColorStop(0.55, base);
    g.addColorStop(1, dark);
    return g;
  }

  flashOverlay(ctx, r, strength = 0.85) {
    if (this.flash <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = this.flash * strength;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
