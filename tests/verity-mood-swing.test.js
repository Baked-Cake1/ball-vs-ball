/* =========================================================================
   tests/verity-mood-swing.test.js
   ---------------------------------------------------------------------------
   Verifies Verity Ball's "Mood Swing" transform pipeline against every way it
   can take damage:

     1. while stunned by Electricity Ball ("High Voltage" shock + DoT)
     2. while gripped and bitten by Vampire Ball ("Blood Bite")
     3. from contact hits (Verity vs Verity "Mood Swing" contact damage)

   ...and proves that no status effect (shock stun, vampire grip) ever blocks
   a transform.

   Instrumentation notes
   ---------------------
   Two modes drive the dice so results are deterministic:

     countMode:  Math.random() inside onDamaged returns 0.5 while
                 transformChance is 0.1, so the roll ALWAYS fires and NEVER
                 transforms. Each roll is counted exactly (no VFX randomness).

     forceMode:  transformChance is 1 and the forced roll returns 0, so every
                 roll transforms (until the mood is maxed). Each transform is
                 recorded together with the freeze state at that instant.

   Run with:  node --test tests/verity-mood-swing.test.js
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
  'src/electricity-ball.js', 'src/vampire-ball.js', 'src/verity-ball.js',
  'src/fighters.js', 'src/arena.js',
];

/** Load the game scripts into an isolated sandbox and expose the classes. */
function buildWorld() {
  /* its own Math so the dice can be forced without touching the test runner */
  const sandboxMath = Object.create(Math);
  const origRandom = Math.random;
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
  vm.runInContext(`
    globalThis.Ball = Ball;
    globalThis.VerityBall = VerityBall;
    globalThis.Arena = Arena;
    globalThis.CONFIG = CONFIG;
  `, sandbox);
  return { sandbox, sandboxMath, origRandom };
}

/** A minimal fighter def for direct (non-arena) unit tests. */
function verityDef(world, hp = 100000) {
  return { id: 'verity', color: '#ffd93b', accent: '#fff3c4', maxHealth: hp, radius: 42 };
}

/** Wrap a fresh Verity instance's damage/transform pipeline with recording. */
function instrument(world, verity) {
  const stats = {
    rolls: 0,               // chance rolls actually attempted
    calls: [],              // one record per onDamaged entry: { t, frozen, source, rolled }
    transforms: [],         // one record per successful transform: { t, stage, frozen }
    inOnDamaged: false,
    currentCall: null,
    forceRoll: 0.5,
  };

  const origOnDamaged = verity.onDamaged.bind(verity);
  verity.onDamaged = function (amount, source) {
    const call = {
      t: this.time,
      frozen: this.frozen ? this.frozen.reason : null,
      source: source && source.def ? source.def.id : (source ? 'anon' : null),
      rolled: false,
    };
    stats.calls.push(call);
    stats.currentCall = call;
    stats.inOnDamaged = true;
    try {
      return origOnDamaged(amount, source);
    } finally {
      stats.inOnDamaged = false;
      stats.currentCall = null;
    }
  };

  const origTransform = verity.transform.bind(verity);
  verity.transform = function () {
    const ok = origTransform();
    if (ok) {
      stats.transforms.push({
        t: this.time,
        stage: this.stage,
        frozen: this.frozen ? this.frozen.reason : null,
      });
    }
    return ok;
  };

  /* first Math.random inside a gated onDamaged call is the chance roll */
  world.sandboxMath.random = function () {
    if (stats.inOnDamaged) {
      if (stats.currentCall && !stats.currentCall.rolled) {
        stats.currentCall.rolled = true;
        stats.rolls++;
      }
      return stats.forceRoll;
    }
    return world.origRandom();
  };

  return stats;
}

function restoreDice(world) {
  world.sandboxMath.random = () => world.origRandom();
}

function makeVerity(world, hp) {
  return new world.sandbox.VerityBall(verityDef(world, hp), {});
}

function makeAttacker(world, id) {
  const b = new world.sandbox.Ball({ id, color: '#fff', accent: '#fff', maxHealth: 1000, radius: 42 }, {});
  return b;
}

/** Run an arena match until `done(arena)` or `cap` simulated seconds. */
function runArena(world, leftId, rightId, done, cap = 120) {
  const arena = new world.sandbox.Arena();
  arena.reset(leftId, rightId);
  arena.onMatchEnd = () => {};
  let t = 0;
  while (!arena.finished && t < cap && !done(arena, t)) {
    arena.update(1 / 60);
    t += 1 / 60;
  }
  return t;
}

const countMode = { chance: 0.1, forceRoll: 0.5 };  // roll always, transform never
const forceMode = { chance: 1, forceRoll: 0 };      // roll always, transform always

function setMode(world, mode) {
  world.sandbox.CONFIG.VERITY.transformChance = mode.chance;
  return mode.forceRoll;
}

/* ======================================================================= */
/* 1. Status effects never block a transform (direct unit checks)          */
/* ======================================================================= */

test('transform fires while stunned (electricity "shock" freeze)', () => {
  const world = buildWorld();
  const v = makeVerity(world);
  const attacker = makeAttacker(world, 'electricity');
  const stats = instrument(world, v);
  stats.forceRoll = setMode(world, forceMode);

  v.applyFreeze('shock', 3);
  assert.ok(v.isFrozen, 'victim should be stunned before the hit');

  v.takeDamage(50, attacker);

  assert.strictEqual(stats.transforms.length, 1, 'exactly one transform');
  assert.strictEqual(stats.transforms[0].frozen, 'shock', 'transformed while stunned');
  assert.strictEqual(v.stage, 1);
  assert.strictEqual(v.radius, 42, 'displeased keeps the base size (scale 1)');
  restoreDice(world);
});

test('transform fires while grip-frozen (vampire "grip")', () => {
  const world = buildWorld();
  const v = makeVerity(world);
  const attacker = makeAttacker(world, 'vampire');
  const stats = instrument(world, v);
  stats.forceRoll = setMode(world, forceMode);

  v.applyFreeze('grip', 1.24);
  v.takeDamage(25, attacker);

  assert.strictEqual(stats.transforms.length, 1, 'exactly one transform');
  assert.strictEqual(stats.transforms[0].frozen, 'grip', 'transformed while gripped');
  restoreDice(world);
});

test('transform fires from a plain contact hit (no freeze involved)', () => {
  const world = buildWorld();
  const v = makeVerity(world);
  const attacker = makeAttacker(world, 'verity');
  const stats = instrument(world, v);
  stats.forceRoll = setMode(world, forceMode);

  v.takeDamage(10, attacker);

  assert.strictEqual(stats.transforms.length, 1);
  assert.strictEqual(stats.transforms[0].frozen, null, 'no status effect was present');
  restoreDice(world);
});

/* ======================================================================= */
/* 2. The damage-event window and transform lockout                        */
/* ======================================================================= */

test('a rapid burst from one attacker is ONE damage event (one roll)', () => {
  const world = buildWorld();
  const v = makeVerity(world);
  const attacker = makeAttacker(world, 'electricity');
  const stats = instrument(world, v);
  stats.forceRoll = setMode(world, countMode);

  /* the electricity DoT ticks every frame for 3 seconds */
  for (let i = 0; i < 180; i++) {
    v.time += 1 / 60;
    v.takeDamage(0.5, attacker);
  }

  assert.ok(stats.calls.length > 100, 'the DoT reaches onDamaged every frame');
  assert.strictEqual(stats.rolls, 1, 'but the whole burst rolls the dice exactly once');
  assert.strictEqual(stats.rolls, stats.calls.filter((c) => c.rolled).length);
  restoreDice(world);
});

test('damage spaced beyond the event window rolls once per hit', () => {
  const world = buildWorld();
  const v = makeVerity(world);
  const attacker = makeAttacker(world, 'vampire');
  const stats = instrument(world, v);
  stats.forceRoll = setMode(world, countMode);

  /* four vampire bites, 0.28s apart (window is 0.2s) */
  for (let i = 0; i < 4; i++) {
    v.time += 0.28;
    v.takeDamage(25, attacker);
  }

  assert.strictEqual(stats.rolls, 4, 'each bite is its own damage event');
  restoreDice(world);
});

test('transform lockout suppresses a second transform within 0.25s', () => {
  const world = buildWorld();
  const v = makeVerity(world);
  const attackerA = makeAttacker(world, 'electricity');
  const attackerB = makeAttacker(world, 'vampire');
  const stats = instrument(world, v);
  stats.forceRoll = setMode(world, forceMode);

  v.time += 1;
  v.takeDamage(10, attackerA);          // roll -> transform happy -> displeased
  assert.strictEqual(v.stage, 1);

  v.time += 0.1;                        // new event (different attacker) but lockout active
  v.takeDamage(10, attackerB);
  assert.strictEqual(stats.rolls, 1,
    'the lockout returns before the dice are even rolled');
  assert.strictEqual(stats.transforms.length, 1, '...so no second transform happens');
  assert.strictEqual(v.stage, 1);

  v.time += 0.3;                        // lockout (0.25) has expired
  v.takeDamage(10, attackerA);
  assert.strictEqual(stats.rolls, 2, 'the dice roll again once the lockout expires');
  assert.strictEqual(v.stage, 2, 'monsterous once the lockout expires');
  assert.strictEqual(v.radius, 84, 'monsterous doubles the size (42 -> 84)');
  restoreDice(world);
});

/* ======================================================================= */
/* 3. Electrocution scenario: Verity vs Electricity Ball                   */
/* ======================================================================= */

test('electrocution: one roll per shock, DoT grouped, transforms work', () => {
  const world = buildWorld();

  /* --- count mode: prove the event grouping --- */
  {
    const arena = new world.sandbox.Arena();
    arena.reset('verity', 'electricity');
    arena.onMatchEnd = () => {};
    const verity = arena.a;
    verity.maxHealth = 1e9;
    verity.health = 1e9;
    const stats = instrument(world, verity);
    stats.forceRoll = setMode(world, countMode);

    let shocks = 0;
    const origApplyShock = arena.b.applyShock.bind(arena.b);
    arena.b.applyShock = (t) => { shocks++; return origApplyShock(t); };

    let t = 0;
    while (!arena.finished && t < 90 && shocks < 5) {
      arena.update(1 / 60);
      t += 1 / 60;
    }

    assert.ok(shocks >= 2, `electricity should land several shocks (got ${shocks})`);
    assert.strictEqual(stats.rolls, shocks,
      'exactly one mood-swing roll per electrocution (impact + DoT = one attack)');
    assert.ok(stats.calls.length > stats.rolls * 10,
      'the DoT trickle keeps reaching onDamaged but is grouped into the shock roll');

    const stunCalls = stats.calls.filter((c) => c.frozen === 'shock');
    assert.ok(stunCalls.length > 10, 'onDamaged runs throughout the stun');
    assert.ok(stats.calls.filter((c) => c.rolled && c.frozen === 'shock').length === 0,
      'no extra dice mid-stun — the shock already rolled on its impact frame');
    restoreDice(world);
  }

  /* --- force mode: the shock actually transforms Verity --- */
  {
    const arena = new world.sandbox.Arena();
    arena.reset('verity', 'electricity');
    arena.onMatchEnd = () => {};
    const verity = arena.a;
    const stats = instrument(world, verity);
    stats.forceRoll = setMode(world, forceMode);

    let shocks = 0;
    const origApplyShock = arena.b.applyShock.bind(arena.b);
    arena.b.applyShock = (t) => { shocks++; return origApplyShock(t); };

    let t = 0;
    while (!arena.finished && t < 90 && shocks < 1) {
      arena.update(1 / 60);
      t += 1 / 60;
    }

    assert.ok(shocks >= 1, 'a shock must land');
    assert.ok(stats.transforms.length >= 1, 'the shock transforms Verity');
    assert.strictEqual(verity.stage, 1, 'happy -> displeased from the electrocution');
    restoreDice(world);
  }
});

/* ======================================================================= */
/* 4. Vampire scenario: Verity vs Vampire Ball                             */
/* ======================================================================= */

test('vampire bites: one roll per bite, transforms fire while gripped', () => {
  const world = buildWorld();

  /* --- count mode: every bite rolls exactly once --- */
  {
    const arena = new world.sandbox.Arena();
    arena.reset('verity', 'vampire');
    arena.onMatchEnd = () => {};
    const verity = arena.a;
    verity.maxHealth = 1e9;
    verity.health = 1e9;
    const stats = instrument(world, verity);
    stats.forceRoll = setMode(world, countMode);

    let bites = 0;
    const origLandBite = arena.b.landBite.bind(arena.b);
    arena.b.landBite = (t) => { bites++; return origLandBite(t); };

    let t = 0;
    while (!arena.finished && t < 60 && bites < 8) {
      arena.update(1 / 60);
      t += 1 / 60;
    }

    assert.ok(bites >= 4, `vampire should land bites (got ${bites})`);
    assert.strictEqual(stats.rolls, bites, 'each bite is its own roll');
    const gripRolls = stats.calls.filter((c) => c.rolled && c.frozen === 'grip');
    assert.strictEqual(gripRolls.length, stats.rolls,
      'every roll happens while the victim is grip-frozen');
    restoreDice(world);
  }

  /* --- force mode: transforms happen mid-bite, while latched on --- */
  {
    const arena = new world.sandbox.Arena();
    arena.reset('verity', 'vampire');
    arena.onMatchEnd = () => {};
    const verity = arena.a;
    const stats = instrument(world, verity);
    stats.forceRoll = setMode(world, forceMode);

    let t = 0;
    while (!arena.finished && t < 60 && verity.stage < 2) {
      arena.update(1 / 60);
      t += 1 / 60;
    }

    assert.ok(stats.transforms.length >= 2,
      'bite 1 and bite 2 of one volley should both transform Verity');
    for (const tr of stats.transforms) {
      assert.strictEqual(tr.frozen, 'grip', 'transformed while the vampire was latched on');
    }
    assert.strictEqual(verity.stage, 2, 'reaches monsterous mid-volley');
    assert.strictEqual(verity.radius, 84, 'monsterous size (42 -> 84) applies while gripped');

    /* the volley finishes and both fighters are released */
    while (!arena.finished && t < 62 && arena.b.volley) {
      arena.update(1 / 60);
      t += 1 / 60;
    }
    assert.strictEqual(verity.frozen, null, 'grip released cleanly after the bite volley');
    restoreDice(world);
  }
});

/* ======================================================================= */
/* 5. Contact scenario: Verity vs Verity                                   */
/* ======================================================================= */

test('verity vs verity contact hits: one roll per hit, both transform', () => {
  const world = buildWorld();

  /* deterministic launch angles so the pair is guaranteed to keep meeting */
  const origLaunch = world.sandbox.Ball.randomLaunchAngle;
  const launch = () => { world.launchFlip = !world.launchFlip; return world.launchFlip ? 30 : 150; };
  world.sandbox.Ball.randomLaunchAngle = launch;

  /* --- count mode --- */
  {
    const arena = new world.sandbox.Arena();
    arena.reset('verity', 'verity');
    arena.onMatchEnd = () => {};
    for (const v of [arena.a, arena.b]) {
      v.maxHealth = 1e9;
      v.health = 1e9;
    }
    const statsA = instrument(world, arena.a);
    statsA.forceRoll = setMode(world, countMode);
    /* share one forced-dice wrapper for both victims */
    const statsB = {
      rolls: 0, calls: [], transforms: [],
      inOnDamaged: false, currentCall: null, forceRoll: statsA.forceRoll,
    };
    const origOnDamagedB = arena.b.onDamaged.bind(arena.b);
    arena.b.onDamaged = function (amount, source) {
      const call = { t: this.time, frozen: this.frozen ? this.frozen.reason : null, rolled: false };
      statsB.calls.push(call);
      statsB.currentCall = call;
      statsB.inOnDamaged = true;
      try { return origOnDamagedB(amount, source); }
      finally { statsB.inOnDamaged = false; statsB.currentCall = null; }
    };
    world.sandboxMath.random = function () {
      const active = statsA.inOnDamaged ? statsA : (statsB.inOnDamaged ? statsB : null);
      if (active) {
        if (active.currentCall && !active.currentCall.rolled) {
          active.currentCall.rolled = true;
          active.rolls++;
        }
        return active.forceRoll;
      }
      return world.origRandom();
    };

    let t = 0;
    while (!arena.finished && t < 90 && (arena.a.hitsLanded + arena.b.hitsLanded) < 10) {
      arena.update(1 / 60);
      t += 1 / 60;
    }

    const hits = arena.a.hitsLanded + arena.b.hitsLanded;
    assert.ok(hits >= 10, `the two Verities should trade plenty of hits (got ${hits})`);
    assert.strictEqual(statsA.rolls + statsB.rolls, hits,
      'every contact hit rolls the victim dice exactly once');
    for (const c of statsA.calls.concat(statsB.calls)) {
      assert.strictEqual(c.frozen, null, 'contact hits never involve a freeze');
    }
    restoreDice(world);
  }

  /* --- force mode: both climb to monsterous purely from contact hits --- */
  {
    const arena = new world.sandbox.Arena();
    arena.reset('verity', 'verity');
    arena.onMatchEnd = () => {};
    const statsA = instrument(world, arena.a);
    statsA.forceRoll = setMode(world, forceMode);

    let t = 0;
    while (!arena.finished && t < 90 && !(arena.a.stage === 2 && arena.b.stage === 2)) {
      arena.update(1 / 60);
      t += 1 / 60;
    }

    assert.strictEqual(arena.a.stage, 2, 'left Verity reaches monsterous');
    assert.strictEqual(arena.b.stage, 2, 'right Verity reaches monsterous');
    assert.strictEqual(arena.a.radius, 84);
    assert.strictEqual(arena.b.radius, 84);
    world.sandbox.Ball.randomLaunchAngle = origLaunch;
    restoreDice(world);
  }
});

/* ======================================================================= */
/* 6. Default 10% chance is wired correctly                                */
/* ======================================================================= */

test('default transformChance is a real 10% roll', () => {
  const world = buildWorld();
  restoreDice(world);   // real randomness for this statistical check

  let transformed = 0;
  const n = 500;
  for (let i = 0; i < n; i++) {
    const v = makeVerity(world, 1000);
    const attacker = makeAttacker(world, 'electricity');
    v.time = i;                     // fresh lockout window per ball
    v.takeDamage(5, attacker);
    if (v.stage > 0) transformed++;
  }

  /* binomial(500, 0.1): mean 50, sd ~6.7 — allow a very generous band */
  assert.ok(transformed >= 15 && transformed <= 100,
    `expected roughly ${n / 10} transforms of ${n}, got ${transformed}`);
});
