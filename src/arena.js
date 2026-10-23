/* =========================================================================
   arena.js — the battleground.
   Owns the square arena, the physics/collision step, the match state
   machine (enter -> ready -> countdown -> fight -> over) and the in-world HUD.
   Coordinates here are all in WORLD units; the renderer scales them.
   ========================================================================= */

const MatchState = {
  ENTER: 'enter',
  READY: 'ready',
  COUNTDOWN: 'countdown',
  FIGHT: 'fight',
  OVER: 'over',
};

class Arena {
  constructor() {
    this.w = CONFIG.WORLD;
    this.h = CONFIG.WORLD;
    this.border = CONFIG.ARENA.border;

    this.state = MatchState.ENTER;
    this.stateTime = 0;
    this.time = 0;

    this.a = null;              // left fighter
    this.b = null;              // right fighter
    this.winner = null;
    this.loser = null;
    this.isDraw = false;

    this.shake = 0;
    this.finished = false;

    this.countdownStep = -1;
    this.fightCallout = 0;
    this.endTimer = 0;

    /* the inner playable rectangle (edges the ball centres bounce off) */
    this.pad = this.border;
  }

  /* -- setup ------------------------------------------------------------ */

  reset(leftId, rightId) {
    this.a = FighterRegistry.build(leftId, 'left');
    this.b = FighterRegistry.build(rightId, 'right');

    const inset = this.pad + this.a.radius + 26;
    this.a.startX = inset;
    this.b.startX = this.w - inset;
    const midY = this.h / 2;
    this.a.startY = midY;
    this.b.startY = midY;

    this.a.x = this.a.homeX;
    this.a.y = midY;
    this.b.x = this.b.homeX;
    this.b.y = midY;

    if (this.a.setOpponent) this.a.setOpponent(this.b);
    if (this.b.setOpponent) this.b.setOpponent(this.a);
    this.a.target = this.b;
    this.b.target = this.a;

    this.state = MatchState.ENTER;
    this.stateTime = 0;
    this.time = 0;
    this.winner = null;
    this.loser = null;
    this.isDraw = false;
    this.shake = 0;
    this.finished = false;
    this.countdownStep = -1;
    this.fightCallout = 0;
    this.endTimer = 0;

    Effects.clear();
  }

  get fighters() { return this.a && this.b ? [this.a, this.b] : []; }

  get ballRadius() { return this.a ? this.a.radius : CONFIG.BALL.radius; }

  /* -- bounds ----------------------------------------------------------- */

  bounds(ball) {
    return {
      minX: this.pad + ball.radius,
      maxX: this.w - this.pad - ball.radius,
      minY: this.pad + ball.radius,
      maxY: this.h - this.pad - ball.radius,
    };
  }

  /* -- main step -------------------------------------------------------- */

  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.fightCallout > 0) this.fightCallout = Math.max(0, this.fightCallout - dt);

    switch (this.state) {
      case MatchState.ENTER: this.updateEnter(dt); break;
      case MatchState.READY: this.updateReady(dt); break;
      case MatchState.COUNTDOWN: this.updateCountdown(dt); break;
      case MatchState.FIGHT: this.updateFight(dt); break;
      case MatchState.OVER: this.updateOver(dt); break;
    }

    Effects.update(dt);
  }

  updateEnter(dt) {
    const t = Utils.clamp(this.stateTime / CONFIG.TIMING.slideIn, 0, 1);
    const e = Utils.easeOutCubic(t);
    for (const ball of this.fighters) {
      ball.x = Utils.lerp(ball.homeX, ball.startX, e);
      ball.y = ball.startY;
      ball.updateVisuals(dt);
    }

    this.faceEachOther(dt, true);

    if (t >= 1) {
      for (const ball of this.fighters) { ball.x = ball.startX; ball.y = ball.startY; }
      this.setState(MatchState.READY);
    }
  }

  /** Any fighter that tracks its opponent (the vampire) looks at it. */
  faceEachOther(dt, snap = false) {
    for (const ball of this.fighters) {
      if (typeof ball.faceTarget === 'function') ball.faceTarget(dt, snap);
    }
  }

  updateReady(dt) {
    if (this.stateTime >= CONFIG.TIMING.settlePause) this.setState(MatchState.COUNTDOWN);
  }

  updateCountdown(dt) {
    const total = CONFIG.TIMING.countdown;
    const elapsed = this.stateTime;
    const step = Math.min(2, Math.floor((elapsed / total) * 3));   // 0,1,2 -> 3,2,1
    if (step !== this.countdownStep) {
      this.countdownStep = step;
      SFX.march(step);
    }
    this.faceEachOther(dt, true);

    if (elapsed >= total) {
      this.setState(MatchState.FIGHT);
      this.fightCallout = CONFIG.TIMING.fightCallout;
      SFX.fight();
      this.launchBoth();
    }
  }

  setState(next) { this.state = next; this.stateTime = 0; }

  /** Both fighters are sent off in random directions at a constant speed. */
  launchBoth() {
    const a = Ball.randomLaunchAngle();
    let b = Ball.randomLaunchAngle();
    /* avoid a perfectly mirrored launch so the first hit is not instant */
    if (Math.abs(Math.abs(a) - Math.abs(b)) < 8) b = Ball.randomLaunchAngle();

    this.a.reset(a);
    this.b.reset(b);
    this.a.x = this.a.startX; this.a.y = this.a.startY;
    this.b.x = this.b.startX; this.b.y = this.b.startY;
    this.linkOpponents();
    if (this.b.faceTarget) this.b.faceTarget(0, true);

    Effects.ring(this.a.x, this.a.y, { color: this.a.accent, from: 6, to: 70, width: 4, life: 0.45 });
    Effects.ring(this.b.x, this.b.y, { color: this.b.accent, from: 6, to: 70, width: 4, life: 0.45 });
  }

  /** Point both fighters (and their generic `target`) at each other. */
  linkOpponents() {
    const [a, b] = this.fighters;
    a.target = b;
    b.target = a;
    if (a.setOpponent) a.setOpponent(b);
    if (b.setOpponent) b.setOpponent(a);
  }
  updateFight(dt) {
    const balls = this.fighters;

    /* The simulation sub-steps so fast balls can never tunnel through each
       other or through a wall in a single frame. */
    const maxStep = this.ballRadius * CONFIG.PHYSICS.maxStepFraction / Math.max(1, this.maxSpeed);
    const steps = Math.max(1, Math.ceil(dt / maxStep));
    const h = dt / steps;

    for (let s = 0; s < steps; s++) {
      for (const ball of balls) if (ball.alive) ball.update(h, this);
      this.resolveWalls();
      this.resolveBallCollision(h);
      /* the separation nudge can nudge a ball against a wall, so the walls
         are re-clamped before the frame is considered settled */
      this.resolveWalls(true);
      this.resolveAbilities();

      for (const ball of balls) {
        if (!ball.alive) { this.endMatch(ball); return; }
      }
    }
  }

  /** Fastest fighter currently in play, used to size the physics sub-steps. */
  get maxSpeed() {
    let m = CONFIG.BALL.baseSpeed;
    for (const b of this.fighters) m = Math.max(m, b.speed);
    return m;
  }

  updateOver(dt) {
    for (const ball of this.fighters) {
      if (ball.alive) ball.update(dt, this);
      else ball.updateVisuals(dt);
    }
    this.resolveWalls();

    if (this.endTimer === 0) this.endTimer = CONFIG.TIMING.resultDelay;
    this.endTimer -= dt;
    if (this.endTimer <= 0 && !this.finished) {
      this.finished = true;
      if (typeof this.onMatchEnd === 'function') this.onMatchEnd(this.winner, this.isDraw);
    }
  }

  /* -- physics ---------------------------------------------------------- */

  resolveWalls(quiet = false) {
    for (const ball of this.fighters) {
      if (!ball.alive) continue;
      /* a frozen or gripped fighter is held exactly where it is */
      if (ball.isFrozen || ball.kinematic) continue;

      const b = this.bounds(ball);
      let hit = false;
      let nx = 0, ny = 0;

      if (ball.x < b.minX) { ball.x = b.minX; ball.vx = Math.abs(ball.vx); hit = true; nx = 1; }
      else if (ball.x > b.maxX) { ball.x = b.maxX; ball.vx = -Math.abs(ball.vx); hit = true; nx = -1; }

      if (ball.y < b.minY) { ball.y = b.minY; ball.vy = Math.abs(ball.vy); hit = true; ny = 1; }
      else if (ball.y > b.maxY) { ball.y = b.maxY; ball.vy = -Math.abs(ball.vy); hit = true; ny = -1; }

      if (!hit) continue;

      ball.normalizeSpeed();
      ball.onWallHit(this);
      if (quiet) continue;
      ball.wallFlash = 1;
      Effects.sparks(ball.x + nx * ball.radius * 0.7, ball.y + ny * ball.radius * 0.7, 8, {
        color: ball.accent, speed: [60, 240], size: [1.5, 3.2], life: [0.15, 0.4],
        dir: Math.atan2(ny, nx), spread: 1.9, drag: 3,
      });
      SFX.bounce();
      this.shake = Math.max(this.shake, 3);
    }
  }

  /** Balls bounce off each other (equal-mass elastic response).
      `h` is the sub-step duration and only affects how much VFX is spawned. */
  resolveBallCollision(h = 1 / 60) {
    const [a, b] = this.fighters;
    if (!a.alive || !b.alive) return;

    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const minD = a.radius + b.radius;
    if (d >= minD) return;

    if (d < 0.0001) {         // perfectly stacked: pick an arbitrary axis
      const a0 = Utils.rand(0, TAU);
      dx = Math.cos(a0); dy = Math.sin(a0); d = 0.0001;
    }

    const nx = dx / d;
    const ny = dy / d;
    const overlap = minD - d;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;

    /* Abilities get first look at the contact. If either fighter reports it is
       actively holding the pair together (a vampire grip), the elastic bounce
       is skipped so they stay locked instead of being flung apart. A fighter
       that is simply rooted by a stun is treated the same way, since the two
       are wedged together until the stun lapses. */
    const aHolds = a.onContactOpponent(b) === true || a.isGripping === true;
    const bHolds = b.onContactOpponent(a) === true || b.isGripping === true;
    if (aHolds || bHolds) return;

    /* Separate them so they never overlap or stick. A frozen or gripped
       fighter is pinned exactly where it is, so the whole separation is
       pushed onto whichever fighter is still free to move. */
    const aPinned = a.isFrozen || a.kinematic;
    const bPinned = b.isFrozen || b.kinematic;
    if (!aPinned && !bPinned) {
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
    } else if (!aPinned) {
      a.x -= nx * overlap;
      a.y -= ny * overlap;
    } else if (!bPinned) {
      b.x += nx * overlap;
      b.y += ny * overlap;
    }

    /* relative velocity along the normal */
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const sep = rvx * nx + rvy * ny;

    if (sep < 0) {
      const impulse = -sep;           // equal masses -> full transfer
      a.vx -= impulse * nx; a.vy -= impulse * ny;
      b.vx += impulse * nx; b.vy += impulse * ny;
    }

    /* a hard nudge guarantees they always come apart */
    a.vx -= nx * 12; a.vy -= ny * 12;
    b.vx += nx * 12; b.vy += ny * 12;

    /* a collision must never change how fast either ball travels */
    a.normalizeSpeed();
    b.normalizeSpeed();

    const power = Math.min(1, Math.abs(sep) / 400);

    /* the impact VFX is emitted once per rendered frame, not per sub-step */
    if (h > 0.004 || Math.random() < 0.5) {
      Effects.ring(cx, cy, {
        color: '#fff', from: 4, to: minD * 1.25, width: 3 + power * 4,
        life: 0.24, fill: true,
      });
      Effects.sparks(cx, cy, 12, {
        color: '#fff3c4', speed: [80, 320], size: [1.6, 3.4], life: [0.14, 0.36], drag: 3.4,
      });
      this.shake = Math.max(this.shake, 6 + power * 6);
      SFX.impact();
    }
  }

  /** Give each ability a chance to trigger while the opponent is in reach. */
  resolveAbilities() {
    const pairs = [[this.a, this.b], [this.b, this.a]];
    for (const [src, dst] of pairs) {
      if (!src.alive || !dst.alive) continue;
      const reach = src.radius + dst.radius + src.touchSlack;
      if (src.distanceTo(dst) <= reach) src.onTouchOpponent(dst);
    }
  }

  /* -- end of match ----------------------------------------------------- */

  endMatch(loser) {
    /* Whatever happened, both fighters are released so nothing stays pinned. */
    for (const ball of this.fighters) {
      if (ball.releaseGrip) ball.releaseGrip();
      ball.clearFreeze();
      ball.kinematic = false;
    }

    this.loser = loser;
    this.winner = loser === this.a ? this.b : this.a;
    this.isDraw = !this.winner.alive;
    if (this.isDraw) this.winner = null;
    this.setState(MatchState.OVER);
    this.endTimer = CONFIG.TIMING.resultDelay;

    loser.vx = 0; loser.vy = 0;

    Effects.ring(loser.x, loser.y, { color: '#fff', from: 6, to: 190, width: 8, life: 0.6, fill: true });
    Effects.sparks(loser.x, loser.y, 46, {
      color: loser.accent, speed: [120, 520], size: [2, 5.5], life: [0.3, 0.9], drag: 2,
    });
    Effects.sparks(loser.x, loser.y, 26, {
      color: '#ffffff', speed: [60, 380], size: [1.5, 3.5], life: [0.25, 0.7], drag: 2.4,
    });
    this.shake = 26;
    SFX.ko();
  }

  /* -- rendering -------------------------------------------------------- */

  drawBackground(ctx) {
    const w = this.w, h = this.h, pad = this.pad;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b1026');
    sky.addColorStop(0.55, '#131a3a');
    sky.addColorStop(1, '#080b1a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /* floor grid inside the walls */
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, pad, w - pad * 2, h - pad * 2);
    ctx.clip();

    const cell = 62;
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = pad; x <= w - pad; x += cell) { ctx.moveTo(x, pad); ctx.lineTo(x, h - pad); }
    for (let y = pad; y <= h - pad; y += cell) { ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); }
    ctx.stroke();

    /* centre marks */
    ctx.strokeStyle = 'rgba(140, 190, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 120, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - 40);
    ctx.lineTo(w / 2, h / 2 + 40);
    ctx.stroke();

    const glow = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, w * 0.62);
    glow.addColorStop(0, 'rgba(90, 140, 255, 0.10)');
    glow.addColorStop(1, 'rgba(90, 140, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);
    ctx.restore();
  }

  drawWalls(ctx) {
    const w = this.w, h = this.h, pad = this.pad;

    ctx.save();
    /* outer band */
    ctx.fillStyle = '#1b2444';
    ctx.fillRect(0, 0, w, pad);
    ctx.fillRect(0, h - pad, w, pad);
    ctx.fillRect(0, pad, pad, h - pad * 2);
    ctx.fillRect(w - pad, pad, pad, h - pad * 2);

    /* metallic sheen */
    const band = ctx.createLinearGradient(0, 0, 0, pad);
    band.addColorStop(0, 'rgba(255,255,255,0.16)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, pad);

    /* glowing inner lip */
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(100, 190, 255, 0.9)';
    ctx.shadowBlur = 20;
    ctx.strokeRect(pad - 1.5, pad - 1.5, w - pad * 2 + 3, h - pad * 2 + 3);
    ctx.shadowBlur = 0;

    /* corner caps */
    ctx.fillStyle = 'rgba(150, 220, 255, 0.75)';
    const cap = pad * 0.5;
    for (const [cx, cy] of [[pad, pad], [w - pad, pad], [pad, h - pad], [w - pad, h - pad]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, cap, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Crackling electricity sheet drawn over a shocked fighter. */
  drawShockAura(ctx, ball) {
    const shock = ball.status.shock;
    if (!shock) return;    const t = ball.time;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#bffcff';
    ctx.shadowColor = '#6fe6ff';
    ctx.shadowBlur = 22;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const r = ball.radius + 8;
    const segs = 16;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      const wob = 1 + 0.13 * Math.sin(a * 5 + t * 22) + 0.07 * Math.sin(a * 9 - t * 31);
      const x = ball.x + Math.cos(a) * r * wob;
      const y = ball.y + Math.sin(a) * r * wob;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  drawBalls(ctx) {
    for (const ball of this.fighters) {
      if (ball.alive) this.drawShockAura(ctx, ball);
    }
    for (const ball of this.fighters) ball.drawShadow(ctx);
    for (const ball of this.fighters) {
      if (ball.alive) ball.draw(ctx);
      else this.drawDefeated(ctx, ball);
    }
    /* the "held in place" marker goes on top of every fighter */
    for (const ball of this.fighters) {
      if (ball.alive && ball.isFrozen) this.drawFreezeMarker(ctx, ball);
    }
  }

  /** A small rotating ring of shards marking a fighter that cannot move. */
  drawFreezeMarker(ctx, ball) {
    const t = this.time;
    const r = ball.radius + 20;
    const gripping = ball.frozen.reason === 'grip';
    const color = gripping ? '#ff8fa3' : '#bffcff';

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    for (let i = 0; i < 4; i++) {
      const a = t * (gripping ? 1.4 : 2.1) + (i / 4) * TAU;
      ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(t * 3 + i));
      ctx.beginPath();
      ctx.arc(0, 0, r, a, a + 0.55);
      ctx.stroke();
    }

    /* a dashed tether between a gripping vampire and its prey */
    if (gripping && ball.target) {
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ball.target.x - ball.x, ball.target.y - ball.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawDefeated(ctx, ball) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.angle);
    ctx.filter = 'grayscale(1) brightness(0.6)';
    ball.drawBody(ctx);
    ctx.filter = 'none';
    ctx.restore();
  }

  /* -- HUD -------------------------------------------------------------- */

  drawHUD(ctx) {
    const w = this.w;
    const barW = w * 0.36;
    const barH = 30;
    const y = 44;
    const margin = 58;

    this.drawHealthBar(ctx, this.a, margin, y, barW, barH, false);
    this.drawHealthBar(ctx, this.b, w - margin - barW, y, barW, barH, true);

    /* centre plate */
    ctx.save();
    ctx.translate(w / 2, y + barH / 2);
    ctx.fillStyle = 'rgba(8, 12, 28, 0.85)';
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.5)';
    ctx.lineWidth = 2;
    Utils.roundRect(ctx, -52, -20, 104, 40, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#cfe6ff';
    ctx.font = '900 22px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', 0, 1);
    ctx.restore();
  }

  drawHealthBar(ctx, ball, x, y, w, h, mirror) {
    const pct = ball.healthPct;
    const ghost = Utils.clamp(ball.ghostHealth / ball.maxHealth, 0, 1);

    ctx.save();
    ctx.translate(x, y);

    /* frame */
    ctx.fillStyle = 'rgba(6, 10, 24, 0.85)';
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.45)';
    ctx.lineWidth = 2;
    Utils.roundRect(ctx, -2, -2, w + 4, h + 4, 8);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    Utils.roundRect(ctx, 0, 0, w, h, 6);
    ctx.clip();

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, w, h);

    const drawBar = (fraction, color, dx = 0) => {
      const bw = w * fraction;
      if (mirror) ctx.fillRect(w - bw + dx, 0, bw, h);
      else ctx.fillRect(dx, 0, bw, h);
      ctx.fillStyle = color;
    };

    /* lagging "damage taken" bar */
    drawBar(ghost, 'rgba(255, 210, 90, 0.55)');

    /* live health */
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, ball.accent);
    g.addColorStop(0.5, ball.color);
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    const bw = w * pct;
    if (mirror) ctx.fillRect(w - bw, 0, bw, h);
    else ctx.fillRect(0, 0, bw, h);

    /* tick marks every 100 hp */
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 1; i < 10; i++) ctx.fillRect((w / 10) * i, 0, 1.5, h);

    ctx.restore();

    /* labels */
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#eaf4ff';
    ctx.font = '800 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = mirror ? 'right' : 'left';
    ctx.fillText(ball.def.name.toUpperCase(), 0, -12);

    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200, 225, 255, 0.7)';
    ctx.textAlign = mirror ? 'left' : 'right';
    ctx.fillText(`${Utils.fmt(ball.health)} / ${ball.maxHealth}`, w, -12);

    ctx.textAlign = mirror ? 'right' : 'left';
    ctx.fillStyle = ball.accent;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(ball.def.tagline, 0, h + 18);

    ctx.restore();
  }

  drawStateOverlay(ctx) {
    const w = this.w, h = this.h;

    if (this.state === MatchState.COUNTDOWN) {
      const total = CONFIG.TIMING.countdown;
      const local = (this.stateTime / total) * 3;
      const step = Math.min(2, Math.floor(local));
      const frac = local - step;
      const label = String(3 - step);
      const size = Utils.lerp(230, 130, frac);
      ctx.save();
      ctx.globalAlpha = Utils.clamp(1 - frac * 0.55, 0, 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(label, w / 2, h / 2);
      const g = ctx.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
      g.addColorStop(0, '#eaf8ff');
      g.addColorStop(1, '#5aa9ff');
      ctx.fillStyle = g;
      ctx.fillText(label, w / 2, h / 2);
      ctx.restore();
    }

    if (this.fightCallout > 0) {
      const t = 1 - this.fightCallout / CONFIG.TIMING.fightCallout;
      const scale = Utils.lerp(0.6, 1.15, Utils.easeOutCubic(Math.min(1, t * 3)));
      ctx.save();
      ctx.globalAlpha = Utils.clamp(this.fightCallout / 0.45, 0, 1);
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 118px "Segoe UI", system-ui, sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText('FIGHT!', 0, 0);
      const g = ctx.createLinearGradient(0, -60, 0, 60);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(1, '#ff7a3d');
      ctx.fillStyle = g;
      ctx.shadowColor = '#ff9a3d';
      ctx.shadowBlur = 30;
      ctx.fillText('FIGHT!', 0, 0);
      ctx.restore();
    }
  }

  draw(ctx) {
    this.drawBackground(ctx);
    this.drawWalls(ctx);
    this.drawBalls(ctx);
    Effects.draw(ctx);
    this.drawHUD(ctx);
    this.drawStateOverlay(ctx);
  }
}
