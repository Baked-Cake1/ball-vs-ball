/* =========================================================================
   tests/berserker-ball.test.js
   ---------------------------------------------------------------------------
   Verifies Berserker Ball's "Last Stand" kit:

     1. the roster integration (id, factory, 800 HP)
     2. the health-driven contact damage formula at exact scale points
     3. the contact hit itself (damage, attribution, bounce-not-hold)
     4. the contact cooldown gate
     5. the grip lash — a grabbed Berserker strikes back mid-hold
     6. a full arena match smoke (mirror)

   Everything here is deterministic: damage is a closed-form function of the
   Berserker's own health, and the launch angles are stubbed for the smoke.

   Run with:  node --test tests/berserker-ball.test.js
   ========================================================================= */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const SRC_FILES = [
  'src/config.js', 'src/utils.js', 'src/sfx.js', 'src/effects.js', 'src/ball.js',
  'src/berserker-ball.js', 'src/fighters.js', 'src/arena.js',
];

/** Load the game scripts into an isolated sandbox and expose the classes. */
function buildWorld() {
  const sandboxMath = Object.create(Math);
  const sandbox = {
    console, Date, Number, Math: sandboxMath,
    performance: { now: () => Date.now() },
    window: { AudioContext: null, webkitAudioContext: null, addEventListener() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    requestAnimationFrame() {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of SRC_FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return vm.runInContext(
    '({ Ball, BerserkerBall, CONFIG, Utils, FIGHTERS, FighterRegistry, Arena })',
    sandbox
  );
}

/** A ready-to-fight pair of Berserkers (the mirror is enough for these tests). */
function buildPair(world) {
  const a = world.FighterRegistry.build('berserker', 'left');
  const b = world.FighterRegistry.build('berserker', 'right');
  a.target = b;
  b.target = a;
  return [a, b];
}

test('roster entry: Berserker Ball is wired into FIGHTERS with 800 HP', () => {
  const world = buildWorld();
  const def = world.FIGHTERS.find((f) => f.id === 'berserker');
  assert.ok(def, 'berserker entry exists');
  assert.equal(def.name, 'Berserker Ball');
  assert.equal(def.tagline, 'Last Stand');
  assert.equal(def.className, 'BerserkerBall');
  assert.equal(def.maxHealth, 800);

  const ball = world.FighterRegistry.build('berserker', 'left');
  assert.ok(ball instanceof world.BerserkerBall, 'factory returns a BerserkerBall');
  assert.equal(ball.maxHealth, 800);
  assert.equal(ball.health, 800);
});

test('damage formula: linear from damageFull at full health to damageEmpty at empty', () => {
  const world = buildWorld();
  const cfg = world.CONFIG.BERSERKER;
  const [ball] = buildPair(world);

  /* the shipped tunables — the formula below must hold for any numbers,
     so assert against the config, not against literals */
  const mid = (cfg.damageFull + cfg.damageEmpty) / 2;

  /* full health: feeble */
  ball.health = ball.maxHealth;
  assert.equal(ball.ragePct, 0);
  assert.equal(ball.contactDamage, cfg.damageFull);

  /* half health: exactly halfway up the ramp */
  ball.health = ball.maxHealth / 2;
  assert.equal(ball.ragePct, 0.5);
  assert.equal(ball.contactDamage, mid);

  /* a quarter left: three quarters up the ramp */
  ball.health = ball.maxHealth / 4;
  assert.ok(Math.abs(ball.contactDamage - (cfg.damageFull + 0.75 * (cfg.damageEmpty - cfg.damageFull))) < 1e-9);

  /* one hit point left: almost damageEmpty (empty is the limit, never reached) */
  ball.health = 1;
  assert.ok(Math.abs(ball.ragePct - (1 - 1 / ball.maxHealth)) < 1e-12);
  assert.ok(Math.abs(ball.contactDamage - (cfg.damageFull + (1 - 1 / ball.maxHealth) * (cfg.damageEmpty - cfg.damageFull))) < 1e-9);
  assert.ok(ball.contactDamage < cfg.damageEmpty, 'never quite reaches the empty-health limit');
});

test('damage formula: strictly grows as its own health falls', () => {
  const world = buildWorld();
  const [ball] = buildPair(world);

  const samples = [800, 640, 400, 200, 50, 1].map((hp) => {
    ball.health = hp;
    return ball.contactDamage;
  });
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] > samples[i - 1], `damage grows: ${samples[i - 1]} -> ${samples[i]}`);
  }
});

test('contact hit: deals contactDamage, counts it, and never holds the pair', () => {
  const world = buildWorld();
  const [a, b] = buildPair(world);

  a.health = a.maxHealth / 2;
  const expected = a.contactDamage;

  const held = a.onContactOpponent(b);
  assert.equal(held, false, 'must return false so the pair always bounces apart');
  assert.equal(b.health, b.maxHealth - expected, 'opponent loses exactly contactDamage');
  assert.equal(a.hitsLanded, 1);
  assert.equal(a.damageDealt, expected);
  assert.equal(b.damageTaken, expected);
});

test('contact cooldown gate: a second contact inside the window is ignored', () => {
  const world = buildWorld();
  const [a, b] = buildPair(world);

  a.onTouchOpponent(b);
  const afterFirst = b.health;

  a.onTouchOpponent(b);
  a.onTouchOpponent(b);
  assert.equal(b.health, afterFirst, 'chained contacts inside contactCooldown deal nothing');

  /* the gate opens again after the cooldown has passed */
  a.time += world.CONFIG.BERSERKER.contactCooldown + 0.01;
  a.onTouchOpponent(b);
  assert.ok(b.health < afterFirst, 'the next contact after the cooldown lands');
});

test('grip lash: grabbed, it strikes back — once per hold, at lash damage', () => {
  const world = buildWorld();
  const cfg = world.CONFIG.BERSERKER;
  const [a, b] = buildPair(world);

  /* not held: a plain update must not land anything by itself */
  a.update(1 / 60, null);
  assert.equal(b.health, b.maxHealth, 'no free hits while unheld');

  /* the vampire latches on: both fighters are frozen with reason 'grip' */
  a.applyFreeze('grip', 1.77);
  const expected = a.contactDamage * cfg.gripLashFactor;

  a.update(1 / 60, null);
  assert.ok(Math.abs((b.maxHealth - b.health) - expected) < 1e-9,
    `lash deals contactDamage x gripLashFactor (${expected})`);

  /* the lash has its own cooldown: the very next frame stays quiet */
  a.update(1 / 60, null);
  assert.ok(Math.abs((b.maxHealth - b.health) - expected) < 1e-9, 'second lash is gated');

  /* and once the cooldown passes it bites again while still held */
  a.time += cfg.gripLashCooldown + 0.01;
  a.update(1 / 60, null);
  assert.ok(Math.abs((b.maxHealth - b.health) - 2 * expected) < 1e-9, 'held long enough, it bites again');

  /* released, it stops */
  a.clearFreeze('grip');
  a.time += cfg.gripLashCooldown + 0.01;
  a.update(1 / 60, null);
  assert.ok(Math.abs((b.maxHealth - b.health) - 2 * expected) < 1e-9, 'no lash once released');
});

test('lash and contact are separate channels: one does not gate the other', () => {
  const world = buildWorld();
  const cfg = world.CONFIG.BERSERKER;
  const [a, b] = buildPair(world);

  /* a fresh contact hit lands... */
  a.onTouchOpponent(b);
  const afterContact = b.health;
  assert.ok(afterContact < b.maxHealth);

  /* ...and the grip lash still fires on the very next update */
  a.applyFreeze('grip', 1.77);
  a.update(1 / 60, null);
  assert.ok(b.health < afterContact, 'the lash is not blocked by the contact cooldown');
});

test('arena smoke (mirror): a full match runs to a verdict with honest books', () => {
  const world = buildWorld();

  /* deterministic launch angles so the run is reproducible */
  let flip = false;
  world.Ball.randomLaunchAngle = () => {
    flip = !flip;
    return flip ? 30 : 150;
  };

  const arena = new world.Arena();
  arena.reset('berserker', 'berserker');
  const dt = 1 / 60;
  let guard = 0;
  while (!arena.finished && guard++ < 60 * 240) arena.update(dt);

  assert.ok(arena.finished, 'the match reaches a verdict');
  const [a, b] = arena.fighters;

  /* every point dealt shows up on the other side's damage taken */
  assert.equal(a.damageDealt, b.damageTaken);
  assert.equal(b.damageDealt, a.damageTaken);
  assert.ok(a.damageDealt > 0 || b.damageDealt > 0, 'the mirror actually fought');

  /* exactly one of: a win, or a draw with both spent */
  if (arena.winner) {
    assert.ok(arena.winner.health > 0);
  } else {
    assert.ok(arena.isDraw);
    assert.ok(!a.alive && !b.alive);
  }
});
