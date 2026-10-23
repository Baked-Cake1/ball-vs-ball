/* =========================================================================
   fighters.js — the playable roster.
   Each entry is pure data plus a factory, so adding a new ball is a matter
   of dropping in a new <name>-ball.js file and adding a definition here.
   ========================================================================= */

const FIGHTERS = [
  {
    id: 'electricity',
    name: 'Electricity Ball',
    tagline: 'High Voltage',
    blurb: 'Electrocutes on contact. 50 impact damage plus 100 over 3 seconds.',
    color: '#2c7cff',
    accent: '#bffcff',
    ballColor: '#1e6ff0',
    className: 'ElectricityBall',
    create(opts) { return new ElectricityBall(this, opts); },
  },
  {
    id: 'vampire',
    name: 'Vampire Ball',
    tagline: 'Blood Bite',
    blurb: 'Latches on with its fangs. 4 bites of 25 damage, all of it stolen.',
    color: '#c8102e',
    accent: '#ffd7dd',
    ballColor: '#c8102e',
    className: 'VampireBall',
    create(opts) { return new VampireBall(this, opts); },
  },
  {
    id: 'verity',
    name: 'Verity Ball',
    tagline: 'Mood Swing',
    blurb: 'Contact damage that grows with its temper: 10, then 80, then 350.',
    color: '#ffd93b',
    accent: '#fff3c4',
    ballColor: '#ffd93b',
    className: 'VerityBall',
    create(opts) { return new VerityBall(this, opts); },
  },
];

const FighterRegistry = {
  byId(id) { return FIGHTERS.find((f) => f.id === id) || FIGHTERS[0]; },
  /** Build a ready-to-fight instance positioned at its starting side. */
  build(id, side) {
    const def = this.byId(id);
    const half = CONFIG.WORLD / 2;
    const fromLeft = side === 'left';
    const ball = def.create({
      homeX: fromLeft ? -CONFIG.BALL.radius * 1.6 : CONFIG.WORLD + CONFIG.BALL.radius * 1.6,
      homeY: half,
      facing: fromLeft ? 1 : -1,
    });
    ball.def = def;
    ball.side = side;
    return ball;
  },
};
