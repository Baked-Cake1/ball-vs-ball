/* =========================================================================
   config.js — All tunable numbers for the battle simulator live here.
   Change values here to rebalance the game; no other file needs editing.
   ========================================================================= */

const CONFIG = {
  /* The simulation runs in a fixed 1000x1000 "world" space and is scaled
     to whatever size the canvas happens to be on screen. */
  WORLD: 1000,

  ARENA: {
    border: 22,      // thickness of the square border walls (world units)
  },

  BALL: {
    radius: 42,
    baseSpeed: 700,  // constant speed — velocity never decays
  },

  PHYSICS: {
    /* Physics is sub-stepped so a fast ball can never skip past its opponent
       in one frame. 0.35 means "never advance more than 35% of a radius". */
    maxStepFraction: 0.35,
  },

  HEALTH: {
    max: 1000,
  },

  TIMING: {
    slideIn: 0.95,        // fighters sliding in from their sides
    settlePause: 0.35,    // beat before the countdown
    countdown: 1.5,       // 3 - 2 - 1
    fightCallout: 1.0,    // how long "FIGHT!" stays on screen
    resultDelay: 1.15,    // pause after a KO before the result card
  },

  /* Electricity Ball ability "High Voltage":
     50 damage on impact + 100 damage trickled over 3 seconds = 150 total,
     the victim is stunned in place for the whole 3 seconds, and the ability
     then needs 8 seconds to recharge before it can shock again. */
  ELECTRICITY: {
    impact: 50,
    dotTotal: 100,
    dotDuration: 3,          // also the stun length
    recharge: 8,             // seconds to recharge after a successful shock
    touchSlack: 50,          // the arc reaches past the ball's surface
    stunGrace: 0.3,          // let a direct hit through this long after the stun ends
  },

  /* Vampire Ball ability "Blood Bite":
     4 bites x 25 damage, each bite landed after a short delay, and every
     point of damage dealt is stolen as health for the vampire. The vampire
     grips on, freezing both fighters in place for the whole bite sequence. */
  VAMPIRE: {
    bites: 4,
    biteDamage: 25,
    biteInterval: 0.28,     // delay between the four bites
    biteCooldown: 2.2,      // min seconds between two bite volleys
    windUp: 0.12,       // delay between gripping on and the first bite
    fangReach: 16,      // extra reach beyond the two radii for a fang hit
  },

  /* Verity Ball ability "Mood Swing":
     a pure contact bruiser — no cooldown, no reach, just damage every time it
     touches the opponent. Its damage is driven entirely by its mood, and every
     hit it TAKES has a chance to sour that mood one stage further. */
  VERITY: {
    stages: [
      { id: 'happy', name: 'Happy', damage: 10, scale: 1, contactCooldown: 0.35 },
      { id: 'displeased', name: 'Displeased', damage: 80, scale: 1, contactCooldown: 0.5 },
      { id: 'monsterous', name: 'Monsterous', damage: 350, scale: 2, contactCooldown: 0.7 },
    ],
    transformChance: 0.1,   // chance to sour one stage per hit taken
    transformLockout: 0.25, // min seconds between two transformations
    transformTime: 0.45,    // how long the change animation runs
    /* A damage-over-time effect trickles damage every single frame. A rapid
       burst of damage from the same attacker is treated as ONE damage event,
       so the roll happens once per attack rather than once per frame. */
    damageEventWindow: 0.2,
    touchSlack: 0,          // contact only — no extra reach
  },
};
