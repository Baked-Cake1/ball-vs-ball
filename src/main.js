/* =========================================================================
   main.js — screen flow, canvas plumbing and UI wiring.
   ========================================================================= */

const Game = {
  canvas: null,
  ctx: null,
  dpr: 1,
  scale: 1,

  arena: new Arena(),
  screen: 'menu',          // 'menu' | 'battle'
  lastTime: 0,
  raf: 0,
  statsTimer: 0,
  paused: false,
  speed: 1,

  selection: { left: null, right: null },

  /* ---------------------------------------------------------------- boot */

  init() {
    this.canvas = document.getElementById('stage');
    this.ctx = this.canvas.getContext('2d');

    this.buildRoster();
    this.bindUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.arena.onMatchEnd = (winner, isDraw) => this.showResult(winner, isDraw);

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  },

  /* ------------------------------------------------------------ canvas */

  resize() {
    const wrap = document.getElementById('stageWrap');
    const rect = wrap.getBoundingClientRect();
    const size = Math.max(240, Math.min(rect.width, rect.height));

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;

    this.scale = (size * this.dpr) / CONFIG.WORLD;
  },

  loop(now) {
    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(raw, 1 / 30);          // clamp so tab-switches don't teleport

    if (this.screen === 'battle' && !this.paused) {
      this.arena.update(dt * this.speed);
    }

    this.render();
    this.statsTimer += dt;
    if (this.statsTimer > 0.1) { this.statsTimer = 0; this.syncLiveStats(); }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  },

  render() {
    const ctx = this.ctx;

    /* The menu screen is pure DOM; no reason to burn a canvas frame on it. */
    if (this.screen !== 'battle') return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.scale(this.scale, this.scale);

    const shake = this.arena.shake;
    if (shake > 0) {
      ctx.translate(Utils.rand(-shake, shake) * 0.5, Utils.rand(-shake, shake) * 0.5);
    }

    this.arena.draw(ctx);
    ctx.restore();
  },

  /* --------------------------------------------------------- menu / UI */

  buildRoster() {
    this.rosterSlots = {
      left: document.querySelector('[data-roster="left"]'),
      right: document.querySelector('[data-roster="right"]'),
    };

    for (const side of ['left', 'right']) {
      const slot = this.rosterSlots[side];
      slot.innerHTML = '';
      for (const def of FIGHTERS) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'fighter-card';
        card.dataset.id = def.id;
        card.dataset.side = side;
        card.innerHTML = `
          <span class="fighter-preview" style="--ball:${def.ballColor};--accent:${def.accent}">
            <span class="fighter-ball">${previewGlyph(def.id)}</span>
          </span>
          <span class="fighter-meta">
            <span class="fighter-name">${def.name}</span>
            <span class="fighter-tag">${def.tagline}</span>
            <span class="fighter-blurb">${def.blurb}</span>
          </span>
        `;
        card.addEventListener('click', () => this.select(side, def.id));
        slot.appendChild(card);
      }
    }

    /* Vs panel starts as a question mark until both sides are picked. */
    this.vsLeft = document.getElementById('vsLeft');
    this.vsRight = document.getElementById('vsRight');
    requestAnimationFrame(() => this.drawVsPreviews());
  },

  drawVsPreviews() {
    this.drawVsPreview(document.getElementById('vsLeft'), this.selection.left);
    this.drawVsPreview(document.getElementById('vsRight'), this.selection.right);
  },

  drawVsPreview(canvas, id) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 128;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!id) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.33, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 200, 255, 0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(200, 220, 255, 0.4)';
      ctx.font = `900 ${size * 0.38}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', size / 2, size / 2 + size * 0.02);
      return;
    }

    const def = FighterRegistry.byId(id);
    const ball = def.create({ facing: 1, homeX: 0, homeY: 0 });
    ball.x = size / 2;
    ball.y = size / 2;
    ball.radius = size * 0.36;
    ball.angle = id === 'vampire' ? 0.5 : -Math.PI / 2;
    ball.time = 1.2;

    ball.drawShadow(ctx);
    ball.draw(ctx);
  },

  select(side, id) {
    this.selection[side] = id;
    SFX.uiClick();

    const slot = this.rosterSlots[side];
    for (const card of slot.querySelectorAll('.fighter-card')) {
      card.classList.toggle('is-picked', card.dataset.id === id);
    }

    this.drawVsPreviews();
    this.updatePlayButton();
  },

  updatePlayButton() {
    const ready = !!(this.selection.left && this.selection.right);
    const btn = document.getElementById('playBtn');
    btn.disabled = !ready;
    btn.classList.toggle('is-ready', ready);

    const hint = document.getElementById('readyHint');
    if (ready) {
      const l = FighterRegistry.byId(this.selection.left);
      const r = FighterRegistry.byId(this.selection.right);
      hint.textContent = `${l.name}  vs  ${r.name}`;
    } else {
      const missing = [];
      if (!this.selection.left) missing.push('Player 1');
      if (!this.selection.right) missing.push('Player 2');
      hint.textContent = missing.length === 2
        ? 'Pick a fighter for each side'
        : `Pick a fighter for ${missing[0]}`;
    }
  },

  bindUI() {
    document.getElementById('playBtn').addEventListener('click', () => this.startBattle());
    document.getElementById('randomBtn').addEventListener('click', () => this.randomMatchup());
    document.getElementById('rematchBtn').addEventListener('click', () => this.rematch());
    document.getElementById('newMatchupBtn').addEventListener('click', () => this.toMenu());
    document.getElementById('menuBtn').addEventListener('click', () => this.toMenu());
    document.getElementById('resumeBtn').addEventListener('click', () => this.togglePause());

    const soundBtn = document.getElementById('soundBtn');
    soundBtn.addEventListener('click', () => {
      soundBtn.classList.toggle('is-muted');
      const muted = soundBtn.classList.contains('is-muted');
      soundBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
      if (!muted) SFX.uiClick();
      SFX.setMuted(muted);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.screen === 'battle') this.toMenu();
      } else if (e.key === ' ') {
        if (this.screen === 'battle') {
          e.preventDefault();
          this.togglePause();
        }
      } else if (e.key === 'Enter') {
        if (this.screen === 'menu' && !document.getElementById('playBtn').disabled) this.startBattle();
      } else if (e.key.toLowerCase() === 'r') {
        if (this.screen === 'battle' && this.arena.finished) this.rematch();
      }
    });
  },

  togglePause() {
    if (this.screen !== 'battle' || this.arena.finished) return;
    this.paused = !this.paused;
    document.getElementById('pauseOverlay').classList.toggle('is-hidden', !this.paused);
  },

  randomMatchup() {
    const a = Utils.pick(FIGHTERS).id;
    let b = Utils.pick(FIGHTERS).id;
    if (b === a) b = FIGHTERS.find((f) => f.id !== a).id;
    this.select('left', a);
    this.select('right', b);
  },

  /* --------------------------------------------------------- flow */

  startBattle() {
    if (!this.selection.left || !this.selection.right) return;
    SFX.ensure();
    SFX.uiClick();

    this.arena.reset(this.selection.left, this.selection.right);
    this.screen = 'battle';
    this.paused = false;

    document.getElementById('menuScreen').classList.add('is-hidden');
    document.getElementById('battleScreen').classList.remove('is-hidden');
    document.getElementById('resultOverlay').classList.add('is-hidden');
    document.getElementById('pauseOverlay').classList.add('is-hidden');

    document.getElementById('battleA').textContent = this.arena.a.def.name;
    document.getElementById('battleB').textContent = this.arena.b.def.name;

    this.resize();
    this.syncLiveStats();
  },

  rematch() {
    document.getElementById('resultOverlay').classList.add('is-hidden');
    this.arena.reset(this.selection.left, this.selection.right);
    document.getElementById('battleA').textContent = this.arena.a.def.name;
    document.getElementById('battleB').textContent = this.arena.b.def.name;
    this.paused = false;
  },

  toMenu() {
    this.screen = 'menu';
    this.paused = false;
    document.getElementById('resultOverlay').classList.add('is-hidden');
    document.getElementById('pauseOverlay').classList.add('is-hidden');
    document.getElementById('battleScreen').classList.add('is-hidden');
    document.getElementById('menuScreen').classList.remove('is-hidden');
    this.resize();
    /* let the menu finish laying out before measuring the vs canvases */
    requestAnimationFrame(() => this.drawVsPreviews());
  },

  /** Live numbers under the canvas so the abilities are easy to read. */
  syncLiveStats() {
    if (this.screen !== 'battle') return;
    const [a, b] = this.arena.fighters;
    if (!a || !b) return;
    this.setStat('a', a);
    this.setStat('b', b);
  },

  setStat(key, ball) {
    const el = document.getElementById(`stat${key.toUpperCase()}`);
    if (!el) return;
    const shock = ball.status.shock ? '<span class="chip chip-shock">shocked</span>' : '';
    const biting = ball.volley ? '<span class="chip chip-bite">biting</span>' : '';
    el.innerHTML = `
      <div class="stat-row"><span>Health</span><b>${Utils.fmt(ball.health)}</b></div>
      <div class="stat-row"><span>Damage dealt</span><b>${Utils.fmt(ball.damageDealt)}</b></div>
      <div class="stat-row"><span>Damage taken</span><b>${Utils.fmt(ball.damageTaken)}</b></div>
      <div class="stat-row"><span>Stolen health</span><b>${Utils.fmt(ball.healed)}</b></div>
      <div class="stat-row"><span>Hits landed</span><b>${ball.hitsLanded}</b></div>
      <div class="stat-flags">${shock}${biting}</div>
    `;
  },

  showResult(winner, isDraw) {
    const overlay = document.getElementById('resultOverlay');
    const title = document.getElementById('resultTitle');
    const sub = document.getElementById('resultSub');
    const [a, b] = this.arena.fighters;

    if (isDraw) {
      title.textContent = 'DOUBLE KNOCKOUT';
      title.className = 'result-title is-draw';
      sub.textContent = 'Both fighters went down at the same time.';
    } else {
      title.textContent = `${winner.def.name} WINS`;
      title.className = 'result-title';
      title.style.color = winner.accent;
      sub.textContent = winner.health >= winner.maxHealth
        ? 'A flawless victory — the health bar never dipped.'
        : `${Utils.fmt(winner.health)} health remaining.`;
    }

    const rows = [
      ['', ...this.arena.fighters.map((f) => f.def.name)],
      ['Health left', ...this.arena.fighters.map((f) => `${Utils.fmt(f.health)} / ${f.maxHealth}`)],
      ['Damage dealt', ...this.arena.fighters.map((f) => Utils.fmt(f.damageDealt))],
      ['Damage taken', ...this.arena.fighters.map((f) => Utils.fmt(f.damageTaken))],
      ['Health stolen', ...this.arena.fighters.map((f) => Utils.fmt(f.healed))],
      ['Hits landed', ...this.arena.fighters.map((f) => f.hitsLanded)],
    ];

    document.getElementById('resultTable').innerHTML = rows.map((row, i) => `
      <tr class="${i === 0 ? 'is-head' : ''}">
        ${row.map((cell) => `<td>${cell}</td>`).join('')}
      </tr>
    `).join('');

    overlay.classList.remove('is-hidden');
    overlay.dataset.winner = isDraw ? '' : winner.def.id;
  },
};

/** Inline SVG glyph shown on the roster cards. */
function previewGlyph(id) {
  if (id === 'electricity') {
    return `<svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M27 3 L12 27 h9 L18 45 L36 21 h-9 z" fill="#d9fbff" stroke="#8ff0ff" stroke-width="2"
        stroke-linejoin="round"/>
    </svg>`;
  }
  if (id === 'verity') {
    /* the happy smiley face */
    return `<svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="17" cy="19" r="4" fill="#3a2a00"/>
      <circle cx="31" cy="19" r="4" fill="#3a2a00"/>
      <path d="M13 29 Q24 41 35 29" fill="none" stroke="#3a2a00" stroke-width="3.4"
        stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="M14 30 L17 45 L21 34 z" fill="#fff8f0" stroke="#7a1424" stroke-width="1.5"/>
    <path d="M34 30 L31 45 L27 34 z" fill="#fff8f0" stroke="#7a1424" stroke-width="1.5"/>
    <circle cx="18" cy="19" r="4" fill="#2a0208"/>
    <circle cx="30" cy="19" r="4" fill="#2a0208"/>
    <circle cx="19.5" cy="19" r="1.6" fill="#ffea00"/>
    <circle cx="31.5" cy="19" r="1.6" fill="#ffea00"/>
  </svg>`;
}

window.addEventListener('DOMContentLoaded', () => Game.init());
