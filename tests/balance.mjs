// The balance simulator (npm run balance). Not a test: it plays the real engine with simple programs
// an average student writes, measures what each one gathers per second, and buys the whole research
// tree in the order a student could afford it. The report says how many real minutes each card takes.
//   node tests/balance.mjs                    today's config → test-reports/balance-now.md + .json
//   node tests/balance.mjs --rev HEAD         the config of another commit (read with git show)
//   node tests/balance.mjs --label try2       the name of the report
//   node tests/balance.mjs --baseline         also writes tests/balance-baseline.json
//   node tests/balance.mjs --suggest          proposes costs for research.json (they stay hand-written)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { loadConfig, makeGame } from './helpers.mjs';
import { CONFIG_FILES } from '../js/core/config.js';
import { SEASON_NAMES } from '../js/engine/calendar.js';

// Every assumption of the model (printed in the report).
const K = {
  warmup: 30, // game seconds a program runs before it is measured
  measure: 120, // game seconds measured, once per season
  playShare: 0.6, // a program runs 60% of the real time (the rest is reading, typing, thinking)
  learnJs: 2, // real minutes to learn a new code card
  learnCrop: 3, // real minutes to learn a new crop
  perLevel: 0.5, // real minutes for any purchase
  handPause: 1.5, // game seconds between two presses of ▶ before the first loop
  cap: 14400, // game seconds: a program whose one turn takes longer is not measured
  wallFactor: 3, // a wall: a gap over 3× the median of the gaps before it …
  wallWindow: 7, // … counted over the last 7 purchases
  soon: 20, // "affordable": gathering its cost takes under 20 real minutes
  carrotsAt: 45, // --suggest: real minutes until the first eggplant card
  totalFactor: 1.5, // --suggest: the whole tree takes this × the baseline
};
const BASELINE = new URL('./balance-baseline.json', import.meta.url);
const REPORTS = new URL('../test-reports/', import.meta.url);
// Inputs a program may spend while it is measured (what it spends counts as its cost).
const STOCK = { Hay: 1e9, Wood: 1e9, Carrot: 1e9, Pumpkin: 1e9, YellowMelon: 1e9, SquareMelon: 1e9, Cactus: 1e9, Seeds: 1e6, Weird_Substance: 1e6, Fish: 1e6, Water: 1e5 };
// Cards that change every program: the drone's speed, the farm's size and the code a student can write.
const COMMON = ['Speed', 'Expand', 'Loops', 'Variables', 'Operators', 'Plant', 'Functions', 'Lists', 'Senses', 'Watering', 'Fertilizer'];

// ------------------------------------------------------------------ the student's programs

const indent = (code, n = 1) => code.split('\n').map((l) => '  '.repeat(n) + l).join('\n');
// One row per turn of the loop; the farm wraps around, so every square gets its turn.
function sweep(c, body) {
  const east = c.W > 1 ? '\ngnal(Aj);' : '';
  const north = c.H > 1 ? '\n  gnal(Verev);' : '';
  if (c.W === 1) return `while (true) {\n${indent(body)}\n}`;
  if (c.for) return `while (true) {\n  for (let i = 0; i < ${c.W}; i++) {\n${indent(body + east, 2)}\n  }${north}\n}`;
  return `while (true) {\n${indent(Array(c.W).fill(body + east).join('\n'))}${north}\n}`;
}
// The whole farm once, back to the start (needs for).
const once = (c, body) => `for (let y = 0; y < ${c.H}; y++) {\n  for (let x = 0; x < ${c.W}; x++) {\n${indent(body, 2)}\n    gnal(Aj);\n  }\n  gnal(Verev);\n}`;
// The whole farm once without for: line after line, the way a beginner copies them.
const onceByHand = (c, body) => Array(c.H).fill(Array(c.W).fill(body + (c.W > 1 ? '\ngnal(Aj);' : '')).join('\n') + (c.H > 1 ? '\ngnal(Verev);' : '')).join('\n');
// Every drone does the same sweep, each starting some rows higher.
function team(c, body) {
  if (!c.for || c.drones < 2 || c.H < 2) return null;
  const step = Math.max(1, Math.floor(c.H / c.drones));
  return `function work() {\n${indent(sweep(c, body))}\n}\nfor (let k = 1; k < maxDronner(); k++) {\n  norDron(work);\n  for (let j = 0; j < ${step}; j++) {\n    gnal(Verev);\n  }\n}\nwork();`;
}
const regrow = (plant) => `if (hasunE()) {\n  havaqel();\n  tnkel(${plant});\n}`;
const onSoil = (plant, before = '') => `if (hasunE()) {\n  havaqel();\n}\n${before}tnkel(${plant});`;
const WATER = 'if (jriQanak() < 0.5) {\n  ogtagorcel(Irer.Jur);\n}\n';
const tillAll = (c) => (c.for ? once(c, 'herkel();') : onceByHand(c, 'herkel();'));
const CHECKER = (a, b) => `if (hasunE()) {\n  havaqel();\n  if ((dirqX() + dirqY()) % 2 == 0) {\n    tnkel(${a});\n  } else {\n    tnkel(${b});\n  }\n}`;
// Mulberries on every second square; the rosehips between them are never harvested, so the bees are always there.
const BEES = 'if ((dirqX() + dirqY()) % 2 == 0) {\n  if (hasunE()) {\n    havaqel();\n    tnkel(Buyser.Tteni);\n  }\n}';
const HOSTS = (c) => c.for && once(c, 'if ((dirqX() + dirqY()) % 2 == 1) {\n  tnkel(Buyser.Masur);\n}');
// Two crops take turns on every square, so the soil never tires.
const TURNS = (a, b) => `if (inchKa() == null) {\n  tnkel(${a});\n}\nif (hasunE()) {\n  if (inchKa() == ${a}) {\n    havaqel();\n    tnkel(${b});\n  } else {\n    havaqel();\n    tnkel(${a});\n  }\n}`;
const SORT_ROW = (c) => `for (let p = 0; p < ${c.W}; p++) {\n  for (let x = 0; x < ${c.W - 1}; x++) {\n    if (chapel() > chapel(Aj)) {\n      poxatexel(Aj);\n    }\n    gnal(Aj);\n  }\n  gnal(Aj);\n}`;
// One step towards the mouse, again and again; then the hat comes off and the skins are paid.
const HUNT = (steps) => `poxelGlxark(Glxarkner.Odz);\nfor (let step = 0; step < ${steps}; step++) {\n  let [ax, ay] = chapel();\n  if (dirqX() < ax && gnal(Aj)) {\n    continue;\n  }\n  if (dirqX() > ax && gnal(Dzax)) {\n    continue;\n  }\n  if (dirqY() < ay && gnal(Verev)) {\n    continue;\n  }\n  if (dirqY() > ay && gnal(Nerqev)) {\n    continue;\n  }\n}\npoxelGlxark(Glxarkner.Cxote);`;
const MUSHROOM = 'if (hasunE()) {\n  if (Math.random() < 0.5) {\n    havaqel(Aj);\n  } else {\n    havaqel(Dzax);\n  }\n}\ntnkel(Buyser.Sunk);';
const EVEN = 'if (hasunE()) {\n  if (chapel() % 2 == 0) {\n    havaqel();\n  } else {\n    herkel();\n    herkel();\n  }\n}\ntnkel(Buyser.Nur);';
const SWEET = 'if (chapel() >= 80) {\n  havaqel();\n}\ntnkel(Buyser.Dzmeruk);';
const VINES = (c, wait) => c.for && `tnkel(Buyser.DexinDzmeruk);\nfor (let i = 0; i < ${wait * (c.W + c.H)}; i++) {\n  salto();\n}\nhavaqel();`;

// id, code(c) → text or null, setup(c) (run once before), uses (cards that change its result besides
// COMMON), cycle (the program ends and is run again: measured over whole turns), hand (▶ pressed by
// hand, with a pause). c = { W, H, for, drones }.
const PROGRAMS = [
  { id: 'hand', hand: true, cycle: true, uses: ['Grass'], code: () => 'havaqel();' },
  { id: 'wheat', uses: ['Grass'], code: (c) => sweep(c, 'havaqel();') },
  { id: 'wheatTeam', uses: ['Grass', 'Megafarm'], code: (c) => team(c, 'havaqel();') },
  { id: 'rosehip', uses: ['Trees', 'Grass'], code: (c) => sweep(c, regrow('Buyser.Masur')) },
  { id: 'apricot', uses: ['Trees', 'Grass'], code: (c) => sweep(c, regrow('Buyser.Ciraneni')) },
  { id: 'apricotTeam', uses: ['Trees', 'Grass', 'Megafarm'], code: (c) => team(c, regrow('Buyser.Ciraneni')) },
  { id: 'mulberry', uses: ['Trees', 'Mulberry', 'Grass'], code: (c) => sweep(c, CHECKER('Buyser.Tteni', 'Buyser.Masur')) },
  { id: 'mulberryBees', uses: ['Trees', 'Mulberry', 'Grass'], setup: HOSTS, code: (c) => c.for && sweep(c, BEES) },
  { id: 'mulberryTeam', uses: ['Trees', 'Mulberry', 'Grass', 'Megafarm'], setup: HOSTS, code: (c) => team(c, BEES) },
  { id: 'eggplant', uses: ['Carrots'], setup: tillAll, code: (c) => sweep(c, onSoil('Buyser.Badrjan')) },
  { id: 'eggplantWater', uses: ['Carrots'], setup: tillAll, code: (c) => sweep(c, onSoil('Buyser.Badrjan', WATER)) },
  { id: 'eggplantTurns', uses: ['Carrots', 'Trees'], setup: tillAll, code: (c) => sweep(c, TURNS('Buyser.Badrjan', 'Buyser.Masur')) },
  { id: 'eggplantTeam', uses: ['Carrots', 'Megafarm'], setup: tillAll, code: (c) => team(c, onSoil('Buyser.Badrjan', WATER)) },
  { id: 'eggplantTurnsTeam', uses: ['Carrots', 'Trees', 'Megafarm'], setup: tillAll, code: (c) => team(c, TURNS('Buyser.Badrjan', 'Buyser.Masur')) },
  { id: 'melon', uses: ['Pumpkins'], setup: tillAll, code: (c) => sweep(c, SWEET) },
  { id: 'melonTurns', uses: ['Pumpkins', 'Carrots'], setup: tillAll, code: (c) => sweep(c, `if (inchKa() == Buyser.Dzmeruk) {\n  if (chapel() >= 80) {\n    havaqel();\n    tnkel(Buyser.Badrjan);\n  }\n} else {\n  if (hasunE()) {\n    havaqel();\n  }\n  tnkel(Buyser.Dzmeruk);\n}`) },
  { id: 'melonTeam', uses: ['Pumpkins', 'Megafarm'], setup: tillAll, code: (c) => team(c, SWEET) },
  { id: 'melonSquare', cycle: true, uses: ['Pumpkins', 'SquareMelon'], setup: tillAll, code: (c) => c.for && `${once(c, 'tnkel(Buyser.QarakusiDzmeruk);')}\n${once(c, 'tnkel(Buyser.QarakusiDzmeruk);')}\nhavaqel();` },
  { id: 'melonYellow', cycle: true, uses: ['Pumpkins', 'YellowMelon'], setup: tillAll, code: (c) => VINES(c, 2) },
  { id: 'melonYellowLong', cycle: true, uses: ['Pumpkins', 'YellowMelon'], setup: tillAll, code: (c) => VINES(c, 6) },
  { id: 'pomegranate', uses: ['Sunflowers'], setup: tillAll, code: (c) => sweep(c, EVEN) },
  { id: 'grape', uses: ['Cactus'], setup: tillAll, code: (c) => sweep(c, onSoil('Buyser.Xaxox')) },
  { id: 'grapeRow', uses: ['Cactus'], setup: tillAll, code: (c) => c.for && c.W > 1 && `while (true) {\n  for (let x = 0; x < ${c.W}; x++) {\n    tnkel(Buyser.Xaxox);\n    gnal(Aj);\n  }\n${indent(SORT_ROW(c))}\n  havaqel();\n  gnal(Verev);\n}` },
  { id: 'snake', cycle: true, uses: ['Dinosaurs'], code: (c) => c.for && HUNT(Math.min(600, 3 * c.W * c.H)) },
  { id: 'fish', uses: ['Fishing'], setup: (c) => (c.for ? once : onceByHand)(c, 'porel();\nogtagorcel(Irer.Jur, 4);'), code: (c) => sweep(c, 'dzukBrnel();') },
  { id: 'mushroom', uses: ['Mushrooms', 'Grass'], code: (c) => sweep(c, MUSHROOM) },
  { id: 'mushroomTeam', uses: ['Mushrooms', 'Grass', 'Megafarm'], code: (c) => team(c, MUSHROOM) },
  { id: 'maze', uses: ['Mazes'], code: () => 'let dirs = [Verev, Aj, Nerqev, Dzax];\nwhile (true) {\n  tnkel(Buyser.Labirint);\n  let d = 0;\n  while (inchKa() != Buyser.Gandz) {\n    let right = (d + 1) % 4;\n    if (karoxEmGnal(dirs[right])) {\n      d = right;\n    } else if (!karoxEmGnal(dirs[d])) {\n      d = (d + 3) % 4;\n      continue;\n    }\n    gnal(dirs[d]);\n  }\n  havaqel();\n}' },
];

// ------------------------------------------------------------------ measuring

function gitConfig(rev) {
  const config = {};
  for (const f of CONFIG_FILES) config[f] = JSON.parse(execFileSync('git', ['show', `${rev}:config/${f}.json`], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  return config;
}

// Seasons stay on, but no luck of the day and no festival bends a measurement.
function neutral(config) {
  const c = structuredClone(config);
  if (c.settings.calendar) c.settings.calendar.luck = [];
  c.events.today = '';
  c.events.festivals = [];
  return c;
}

// A real moment (ms) in each season with sunny weather.
function seasonClocks(config) {
  const cal = makeGame({ config, clock: 0 }).calendar;
  const step = config.settings.calendar.weatherMinutes * 60000;
  const out = {};
  for (let t = Date.UTC(2026, 2, 10, 8); Object.keys(out).length < 4; t += step) {
    const s = cal.at(t + 1000);
    if (s.weather === 'Sunny' && !out[s.season]) out[s.season] = t + 1000;
  }
  return SEASON_NAMES.map((s) => out[s]);
}

// What `prog` changes in the storage per game second at these research levels (null: it can't be written yet).
function measure(config, prog, levels, clock, problems) {
  const game = makeGame({ config, levels, items: STOCK, clock, seed: 7 });
  const c = { W: game.world.width, H: game.world.height, drones: game.maxDrones(), for: ['loops', 'variables', 'operators'].every((f) => game.research.hasSyntax(f)) };
  const code = prog.code(c);
  const setup = prog.setup && prog.setup(c);
  if (!code) return null;
  const errors = [];
  game.events.on('runError', (e) => errors.push(e.error));
  // (a program the gate refuses is one the student can't write yet: no rate, no problem)
  const start = (text) => {
    game.scripts = [{ name: 'main', code: text }];
    return game.runner.start('main').ok;
  };
  const idle = () => game.runner.state === 'idle';
  let moves = 0;
  game.events.on('move', (e) => (moves += e.drone === 0));
  // Runs for `seconds`, and for two passes over the farm if that takes longer (on a big farm the first
  // harvest comes only on the second pass). A program that ends (cycle, hand) is started again and
  // always finishes its turn.
  const play = (seconds) => {
    const from = game.time;
    const first = moves;
    for (;;) {
      const t = game.time - from;
      if (errors.length || t >= K.cap) return false;
      if (t >= seconds && (prog.cycle ? idle() : moves === first || moves - first >= 2 * c.W * c.H)) return true;
      if (idle() && !start(code)) return false;
      game.update(0.1);
      if (idle() && !prog.cycle) return false; // an endless loop must not end
      if (idle() && prog.hand) for (let wait = game.time + K.handPause; game.time < wait; ) game.update(0.1);
    }
  };
  if (setup) {
    if (!start(setup)) return null;
    for (const end = game.time + K.cap; !idle() && game.time < end; ) game.update(0.1);
    if (!idle()) game.runner.stop('setup', true);
  }
  if (errors.length || game.api.check('main', code).length) return null;
  const warm = play(K.warmup);
  const before = new Map(game.inventory.items);
  const from = game.time;
  if (!warm || !play(K.measure)) {
    if (errors.length) problems.set(prog.id, `${prog.id}: ${errors[0].code}`);
    return null;
  }
  const rates = {};
  for (const [item, n] of game.inventory.items) {
    const d = (n - (before.get(item) || 0)) / (game.time - from);
    if (Math.abs(d) > 1e-9) rates[item] = d;
  }
  return rates;
}

// ------------------------------------------------------------------ the buying model

class Sim {
  constructor(config) {
    this.config = neutral(config);
    this.clocks = this.config.settings.calendar ? seasonClocks(this.config) : [undefined];
    this.cache = new Map();
    this.problems = new Map(); // programs that broke …
    this.worked = new Set(); // … and never worked at any stage
    this.nodes = this.config.research.nodes.filter((n) => n.available !== false);
  }

  // { programId: { item: perSecond } }: every program the student can write now, averaged over the seasons.
  rates(levels) {
    const out = {};
    for (const prog of PROGRAMS) {
      const key = `${prog.id}|${[...COMMON, ...prog.uses].map((id) => levels[id] || 0).join(',')}`;
      if (!this.cache.has(key)) {
        const runs = this.clocks.map((clock) => measure(this.config, prog, levels, clock, this.problems));
        let avg = null;
        if (runs.every(Boolean)) {
          this.worked.add(prog.id);
          avg = {};
          for (const r of runs) for (const [item, v] of Object.entries(r)) avg[item] = (avg[item] || 0) + v / runs.length;
        }
        this.cache.set(key, avg);
      }
      if (this.cache.get(key)) out[prog.id] = this.cache.get(key);
    }
    return out;
  }

  // The program that gives `item` cheapest in time, counting the time to gather what it spends.
  planner(rates) {
    const cost = new Map(); // item -> { seconds: per unit, prog }
    const visiting = new Set();
    const unit = (item) => {
      if (cost.has(item)) return cost.get(item);
      if (visiting.has(item)) return { seconds: Infinity };
      visiting.add(item);
      let best = { seconds: Infinity };
      for (const [id, r] of Object.entries(rates)) {
        if (!(r[item] > 0)) continue;
        let seconds = 1;
        for (const [j, v] of Object.entries(r)) if (v < 0) seconds += -v * unit(j).seconds;
        if (seconds / r[item] < best.seconds) best = { seconds: seconds / r[item], prog: id };
      }
      visiting.delete(item);
      cost.set(item, best);
      return best;
    };
    // Makes `inv` hold at least `targets`; returns the game seconds it takes (Infinity: impossible now).
    // `floor`: what the callers have gathered so far and a program further down must not spend.
    const gather = (targets, inv, used = {}, depth = 0, floor = {}) => {
      let seconds = 0;
      for (let guard = 0; guard < 200; guard++) {
        const m = Object.keys(targets).find((k) => (inv[k] || 0) < targets[k] - 1e-6);
        if (!m) return seconds;
        const best = unit(m);
        if (!best.prog || depth > 8) return Infinity;
        const r = rates[best.prog];
        const d = (targets[m] - (inv[m] || 0)) / r[m];
        const keep = { ...floor };
        for (const [k, v] of Object.entries(targets)) if (k !== m) keep[k] = Math.max(keep[k] || 0, v);
        const inputs = {};
        for (const [j, v] of Object.entries(r)) if (v < 0) inputs[j] = Math.min(inv[j] || 0, keep[j] || 0) - v * d;
        seconds += gather(inputs, inv, used, depth + 1, keep);
        if (seconds === Infinity) return Infinity;
        for (const [j, v] of Object.entries(r)) inv[j] = Math.max(0, (inv[j] || 0) + v * d);
        seconds += d;
        used[best.prog] = (used[best.prog] || 0) + d;
      }
      return Infinity;
    };
    gather.unit = unit;
    return gather;
  }

  run() {
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const levels = {};
    const inv = {};
    const rows = [];
    const watch = this.watchList();
    const seen = {};
    let minutes = 0;
    for (;;) {
      const gather = this.planner(this.rates(levels));
      for (const [name, cost] of Object.entries(watch)) {
        if (seen[name] === undefined && gather(cost, { ...inv }) / 60 / K.playShare <= K.soon) seen[name] = minutes;
      }
      let pick = null;
      for (const n of this.nodes) {
        const lvl = levels[n.id] || 0;
        if (n.top || lvl >= n.tiers.length || !(n.parents || []).every((p) => levels[p] > 0 || !byId.has(p))) continue;
        const after = { ...inv };
        const used = {};
        const seconds = gather(n.tiers[lvl], after, used);
        if (seconds < (pick ? pick.seconds : Infinity)) pick = { n, lvl, seconds, after, used };
      }
      if (!pick) break;
      const { n, lvl } = pick;
      const cost = n.tiers[lvl];
      for (const [item, v] of Object.entries(cost)) pick.after[item] -= v;
      Object.keys(inv).forEach((k) => delete inv[k]);
      Object.assign(inv, pick.after);
      const g = n.grants || {};
      const learn = K.perLevel + (lvl ? 0 : (g.entities || []).length ? K.learnCrop : (g.syntax || g.functions || []).length ? K.learnJs : 0);
      const farm = pick.seconds / 60 / K.playShare;
      const scratch = gather(cost, {}) / 60 / K.playShare; // the same cost from an empty storage (for --suggest)
      minutes += farm + learn;
      levels[n.id] = lvl + 1;
      const program = Object.entries(pick.used).sort((a, b) => b[1] - a[1]).map(([id]) => id)[0] || '';
      rows.push({ id: n.id, level: lvl + 1, cost, learn, farm, scratch, gap: farm + learn, minutes, program });
    }
    // What is left can't be gathered: say which item no program gives (or which chain goes round in a circle).
    const last = this.planner(this.rates(levels));
    const left = this.nodes
      .filter((n) => !n.top && (levels[n.id] || 0) < n.tiers.length)
      .map((n) => {
        const cost = n.tiers[levels[n.id] || 0];
        const none = Object.keys(cost).filter((item) => last.unit(item).seconds === Infinity);
        return `${n.id} ${(levels[n.id] || 0) + 1} (${none.length ? `no program gives ${none.join(', ')}` : (n.parents || []).some((p) => !levels[p]) ? 'a parent card is missing' : 'its cost eats itself'})`;
      });
    return { rows, left, watch: seen, problems: [...this.problems].filter(([id]) => !this.worked.has(id)).map(([, text]) => text) };
  }

  // The Ranch and Market cards and the village buildings (their ⭐ come from requests, not from a program).
  watchList() {
    const out = {};
    const noStars = (cost) => Object.fromEntries(Object.entries(cost).filter(([k]) => k !== 'Star'));
    for (const n of this.nodes) if (n.top) out[n.id] = n.tiers[0];
    for (const b of this.config.village.buildings) if (b.available !== false) out[`village ${b.id}`] = noStars(b.cost);
    return out;
  }
}

// ------------------------------------------------------------------ the report

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const clockText = (m) => (m < 100 ? `${m.toFixed(1)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toPrecision(3)}M` : n >= 1e4 ? `${+(n / 1e3).toPrecision(3)}k` : String(n));
const costText = (cost) => Object.entries(cost).map(([k, v]) => `${k} ${short(v)}`).join(' + ');

function summarize(result, label) {
  const { rows } = result;
  rows.forEach((r, i) => {
    const recent = rows.slice(Math.max(0, i - K.wallWindow), i).map((x) => x.gap);
    r.wall = recent.length >= 3 && r.gap > K.wallFactor * median(recent);
  });
  const carrots = rows.find((r) => r.id === 'Carrots');
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  const total = rows.length ? rows[rows.length - 1].minutes : 0;
  return { label, constants: K, carrots: carrots ? carrots.minutes : null, total, ratio: base ? total / base.total : null, baseline: base && { carrots: base.carrots, total: base.total }, walls: rows.filter((r) => r.wall).map((r) => `${r.id} ${r.level}`), ...result };
}

function markdown(s) {
  const lines = [`# Balance: ${s.label}`, '', `- First eggplant card (Carrots): **${s.carrots === null ? 'never' : clockText(s.carrots)}**`, `- The whole tree: **${clockText(s.total)}**${s.ratio ? ` (${s.ratio.toFixed(2)}× the baseline of ${clockText(s.baseline.total)})` : ''}`];
  lines.push(`- Walls (a gap over ${K.wallFactor}× the median of the last ${K.wallWindow}): ${s.walls.length ? s.walls.join(', ') : 'none'}`);
  if (s.left.length) lines.push(`- **Never affordable with these programs:** ${s.left.join(', ')}`);
  lines.push(`- Becomes affordable (under ${K.soon} real minutes of farming): ${Object.entries(s.watch).map(([k, m]) => `${k} at ${clockText(m)}`).join(', ') || 'nothing'}`);
  if (s.problems.length) lines.push(`- Programs that broke: ${s.problems.join('; ')}`);
  lines.push('', `Model: ${Object.entries(K).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '', '| # | Card | Cost | Gap | Reached at | Program | |', '|---|---|---|---|---|---|---|');
  s.rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.id} ${r.level} | ${costText(r.cost)} | ${clockText(r.gap)} | ${clockText(r.minutes)} | ${r.program} | ${r.wall ? 'WALL' : ''} |`));
  return `${lines.join('\n')}\n`;
}

// Costs that would put every purchase on the target curve: the farming time for a card grows evenly
// from the first card (its cost stays: the first quests count on it) to the first eggplant card, which
// comes at K.carrotsAt, and then evenly until the whole tree takes K.totalFactor × the baseline.
// (Learning time comes on top.) Same items, scaled, 2 digits.
function suggest(s) {
  if (!s.baseline) throw new Error('No tests/balance-baseline.json yet: run with --baseline on the old config first.');
  const rows = s.rows;
  const c = rows.findIndex((r) => r.id === 'Carrots');
  const learn = (from, to) => rows.slice(from, to).reduce((a, r) => a + r.learn, 0);
  // the ratio q of times g·q, g·q², … (n of them) that add up to `sum`
  const ratio = (g, n, sum) => {
    let lo = 0.5;
    let hi = 3;
    for (let i = 0; i < 80; i++) {
      const q = (lo + hi) / 2;
      let total = 0;
      for (let k = 0, x = g * q; k < n; k++, x *= q) total += x;
      if (total < sum) lo = q;
      else hi = q;
    }
    return (lo + hi) / 2;
  };
  const first = rows[0].farm;
  const q1 = ratio(first, c, K.carrotsAt - learn(0, c + 1) - first);
  const atCarrots = first * Math.pow(q1, c);
  const q2 = ratio(atCarrots, rows.length - c - 1, K.totalFactor * s.baseline.total - K.carrotsAt - learn(c + 1));
  const out = new Map();
  rows.forEach((r, i) => {
    const farm = i <= c ? first * Math.pow(q1, i) : atCarrots * Math.pow(q2, i - c);
    const k = i && r.scratch > 0 ? farm / r.scratch : 1;
    const cost = Object.fromEntries(Object.entries(r.cost).map(([item, v]) => [item, Math.max(1, +(v * k).toPrecision(2))]));
    if (!out.has(r.id)) out.set(r.id, []);
    out.get(r.id)[r.level - 1] = cost;
  });
  return [...out].map(([id, tiers]) => `${id}: ${JSON.stringify(tiers)}`).join('\n');
}

// ------------------------------------------------------------------ command line

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const rev = arg('--rev');
const label = arg('--label') || (rev ? rev.replace(/\W+/g, '-') : 'now');
const started = Date.now();
const summary = summarize(new Sim(rev ? gitConfig(rev) : loadConfig()).run(), label);
if (!existsSync(REPORTS)) mkdirSync(REPORTS);
writeFileSync(new URL(`balance-${label}.md`, REPORTS), markdown(summary));
writeFileSync(new URL(`balance-${label}.json`, REPORTS), JSON.stringify(summary, null, 1));
if (args.includes('--baseline')) writeFileSync(BASELINE, `${JSON.stringify({ label, carrots: summary.carrots, total: summary.total, rows: summary.rows.map((r) => ({ id: r.id, level: r.level, minutes: +r.minutes.toFixed(1) })) }, null, 1)}\n`);
console.log(markdown(summary));
if (args.includes('--suggest')) console.log(`Suggested tiers (research.json):\n${suggest(summary)}`);
console.log(`Report: test-reports/balance-${label}.md (${((Date.now() - started) / 1000).toFixed(0)} s)`);
