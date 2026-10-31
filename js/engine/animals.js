// One ranch area (config/ranch.json → areas): its things (basket, well, troughs, the market's stall),
// its animals and the eggs and dirt on its squares. Hunger and thirst grow; a hungry or thirsty
// animal walks to a trough that has what it needs (otherwise it steps around now and then), eats or
// drinks there, dirties the square it stands on, and gives its goods while it is happy enough (a hen
// lays an egg on its square, a cow's milk gets ready). An egg left on the ground hatches, two happy
// adults get a baby (it has a parent's colour), an animal standing long in dirt gets sick, goats butt
// the fence until it has a hole and animals run away through it, and the workshop's machines make
// their recipes. An area is brought up to date in whole steps of STEP game seconds with its own random
// numbers, so the same program gives the same ranch at any speed or frame rate.
import { Rng } from '../core/rng.js';
import { clamp } from '../core/util.js';

export const STEP = 0.25;
const key = (x, y) => `${x},${y}`;
const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const SIDES = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };

export class Pen {
  // saved: Pen.toSave() (nothing for a new area); seed: its random numbers when it is new.
  constructor(ranch, id, saved, seed) {
    const s = saved || {};
    this.ranch = ranch;
    this.id = id;
    this.cfg = ranch.cfg.areas[id];
    this.rng = new Rng(s.rng ?? seed);
    this.steps = s.steps ?? Math.floor(ranch.time / STEP + 1e-6);
    this.objects = s.objects || Object.entries(this.cfg.objects || {}).map(([type, [x, y]]) => ({ type, x, y, amount: 0 }));
    this.animals = s.animals || [];
    this.dirt = s.dirt || {}; // { 'x,y': 0…100 }
    this.ground = s.ground || {}; // goods lying on squares: { 'x,y': 'Egg' }
    this.laid = s.laid || {}; // eggs on the ground that can hatch: { 'x,y': { t, color } }
    this.fence = s.fence || {}; // damaged fence pieces on the edge: { 'x,y,N': strength } (0 = a hole)
    this.runaways = s.runaways || []; // animals that left through a hole
    this.breedT = s.breedT || 0;
    this.drone = null; // made by the ranch
    this.runner = null;
  }

  get size() {
    return this.ranch.penSize(this.id);
  }

  get animalCfg() {
    return (this.cfg.animal && this.ranch.cfg.animals[this.cfg.animal]) || null;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  objectAt(x, y) {
    return this.objects.find((o) => o.x === x && o.y === y) || null;
  }

  animalsAt(x, y) {
    return this.animals.filter((a) => a.x === x && a.y === y);
  }

  // How many animals live here happily; more make everyone sad.
  capacity() {
    const c = this.animalCfg;
    return c ? Math.floor((this.size * this.size) / c.space) : 0;
  }

  // A new animal on a free square (or any square when all are taken). A bought one gets a colour by its
  // id; a baby (born: { x, y, color, at }) is young until it grows.
  addAnimal(type, id, born = null) {
    const n = this.size;
    let x = born ? born.x : this.rng.int(0, n - 1);
    let y = born ? born.y : this.rng.int(0, n - 1);
    for (let i = 0; !born && i < 20 && (this.objectAt(x, y) || this.animalsAt(x, y).length); i++) {
      x = this.rng.int(0, n - 1);
      y = this.rng.int(0, n - 1);
    }
    const c = this.ranch.cfg.animals[type];
    const colors = c.colors || [];
    const a = { id, type, x, y, hunger: 20, thirst: 20, mood: 80, prod: 0, petUntil: 0, timer: this.rng.int(1, 8) };
    if (colors.length) a.color = born ? born.color : colors[id % colors.length];
    if (born) a.grownAt = born.at + (c.grow ?? 0);
    this.animals.push(a);
    return a;
  }

  // A baby's colour: a parent's, or now and then the rare one.
  childColor(type, parent) {
    const c = this.ranch.cfg.animals[type];
    const n = this.ranch.cfg.needs || {};
    return c.rare && this.rng.chance(n.rareChance ?? 0) ? c.rare : parent;
  }

  young(a, now) {
    return a.grownAt !== undefined && now < a.grownAt;
  }

  // The fence sides of an edge square that face out of the pen.
  sides(x, y) {
    const n = this.size;
    return Object.keys(SIDES).filter((k) => !this.inside(x + SIDES[k][0], y + SIDES[k][1]) && x >= 0 && y >= 0 && x < n && y < n);
  }

  // The side with a hole on (x, y), or null.
  holeAt(x, y) {
    return this.sides(x, y).find((k) => this.fence[`${x},${y},${k}`] === 0) || null;
  }

  holes() {
    return Object.keys(this.fence).filter((k) => this.fence[k] === 0);
  }

  // ---------------------------------------------------------------- time

  sync(t) {
    const target = Math.floor(t / STEP + 1e-6);
    while (this.steps < target) {
      this.steps++;
      this.tick(this.steps * STEP);
    }
  }

  tick(now) {
    this.machines(now);
    const c = this.animalCfg;
    if (!c) return;
    const n = this.ranch.cfg.needs || {};
    const f = this.ranch.seasonFactors();
    const crowded = this.animals.length > this.capacity();
    const leaving = [];
    for (const a of this.animals) {
      const hungry = a.hunger >= n.seek;
      a.hunger = Math.min(100, a.hunger + c.needs.hunger * f.hunger * STEP);
      a.thirst = Math.min(100, a.thirst + c.needs.thirst * f.thirst * STEP);
      if (!hungry && a.hunger >= n.seek) this.signal('sovac', { id: a.id, x: a.x, y: a.y }, now);
      const k = key(a.x, a.y);
      this.dirt[k] = Math.min(100, (this.dirt[k] || 0) + c.needs.dirt * f.dirt * STEP);
      if (n.sickDirt !== undefined) {
        a.dirtTime = this.dirt[k] >= n.sickDirt ? (a.dirtTime || 0) + STEP : Math.max(0, (a.dirtTime || 0) - STEP);
        if (!a.sick && a.dirtTime >= n.sickSeconds) {
          a.sick = true;
          this.ranch.events.emit('sick', { pen: this.id, id: a.id, x: a.x, y: a.y });
        }
      }
      let target = 100;
      if (a.hunger >= n.unhappy) target -= 35;
      if (a.thirst >= n.unhappy) target -= 35;
      if (this.dirt[k] >= n.dirty) target -= 20;
      if (crowded) target -= 20;
      if (a.sick) target -= 40;
      if (a.petUntil > now) target = Math.min(100, target + n.petBoost);
      a.mood += clamp(target - a.mood, -n.moodSpeed * STEP, n.moodSpeed * STEP);
      // a sad, sick, young, starving or very thirsty animal gives nothing
      if (a.mood >= n.sad && !a.sick && !this.young(a, now) && a.hunger < 100 && a.thirst < 100 && a.prod < 1) {
        a.prod = Math.min(1, a.prod + (STEP / c.every) * (a.mood / 100));
        if (a.prod >= 1 && !c.lays) this.signal('kat', { id: a.id, x: a.x, y: a.y }, now);
      }
      if (a.prod >= 1 && c.lays && !this.ground[k] && !this.objectAt(a.x, a.y)) {
        this.ground[k] = c.product;
        if (c.hatch) this.laid[k] = { t: now, color: a.color };
        a.prod = 0;
        this.ranch.events.emit('laid', { pen: this.id, x: a.x, y: a.y, item: c.product });
        this.signal('dzu', { x: a.x, y: a.y }, now);
      }
      if (--a.timer <= 0) {
        const base = Math.max(1, Math.round(c.step / STEP));
        a.timer = (base + this.rng.int(0, Math.floor(base / 2))) * (a.sick ? 2 : 1);
        if (this.act(a, n, now)) leaving.push(a);
      }
    }
    for (const a of leaving) {
      this.animals.splice(this.animals.indexOf(a), 1);
      const { fromX, fromY, movedAt, ...rest } = a;
      this.runaways.push(rest);
      this.ranch.events.emit('runaway', { pen: this.id, id: a.id, x: a.x, y: a.y });
    }
    this.babies(c, n, f, now);
  }

  // An event for the drones listening in this area (erb()).
  signal(name, data, now) {
    this.ranch.signal(this.id, name, data, now);
  }

  // Eggs left on the ground hatch; two happy adults get a baby now and then (faster in spring).
  babies(c, n, f, now) {
    const room = () => this.animals.length < this.capacity();
    for (const [k, egg] of Object.entries(this.laid)) {
      if (this.ground[k] !== c.product) {
        delete this.laid[k];
        continue;
      }
      if (!room() || now - egg.t < c.hatch / f.breed) continue;
      const [x, y] = k.split(',').map(Number);
      delete this.ground[k];
      delete this.laid[k];
      this.born(this.cfg.animal, { x, y, color: this.childColor(this.cfg.animal, egg.color), at: now });
    }
    if (!c.breed) return;
    const happy = this.animals.filter((a) => a.mood >= (n.happy ?? 70) && !a.sick && !this.young(a, now));
    if (happy.length < 2 || !room()) return;
    this.breedT += STEP * f.breed;
    if (this.breedT < c.breed) return;
    this.breedT = 0;
    const mother = happy[this.rng.int(0, happy.length - 1)];
    this.born(this.cfg.animal, { x: mother.x, y: mother.y, color: this.childColor(this.cfg.animal, mother.color), at: now });
  }

  born(type, b) {
    const a = this.addAnimal(type, this.ranch.nextAnimal++, b);
    this.ranch.events.emit('born', { pen: this.id, id: a.id, x: a.x, y: a.y, color: a.color });
    this.ranch.counts.born++;
    this.ranch.main.events.emit('ranch', { born: type });
  }

  // The workshop's machines finish what they make.
  machines(now) {
    for (const o of this.objects) {
      if (!o.making || now < o.until) continue;
      o.ready = o.making;
      o.making = null;
      this.ranch.events.emit('made', { pen: this.id, x: o.x, y: o.y, item: o.ready });
      this.signal('patrast', { x: o.x, y: o.y, ir: o.ready }, now);
    }
  }

  // Eats or drinks where it stands, or walks to what it needs most, or steps around. A goat on the edge
  // butts the fence; an animal by a hole may leave (returns true then).
  act(a, n, now) {
    const c = this.animalCfg;
    const hole = this.holeAt(a.x, a.y);
    if (hole && (c.butt || a.mood < (n.runaway ?? 0))) return true;
    const here = this.objectAt(a.x, a.y);
    if (here && here.amount > 0 && ((here.type === 'FeedTrough' && a.hunger >= n.seek) || (here.type === 'WaterTrough' && a.thirst >= n.seek))) {
      here.amount--;
      if (here.type === 'FeedTrough') a.hunger = Math.max(0, a.hunger - n.fill);
      else a.thirst = Math.max(0, a.thirst - n.fill);
      if (!here.amount) this.signal('datark', { x: here.x, y: here.y }, now);
      return false;
    }
    const sides = c.butt ? this.sides(a.x, a.y) : [];
    if (sides.length && this.rng.chance(c.butt)) {
      const k = `${a.x},${a.y},${sides[this.rng.int(0, sides.length - 1)]}`;
      if (this.fence[k] !== 0) {
        this.fence[k] = Math.max(0, (this.fence[k] ?? 100) - (n.fenceHit ?? 25));
        if (!this.fence[k]) {
          this.ranch.events.emit('hole', { pen: this.id, x: a.x, y: a.y });
          this.signal('ancq', { x: a.x, y: a.y }, now);
        }
      }
      return false;
    }
    const wants = [
      ['FeedTrough', a.hunger],
      ['WaterTrough', a.thirst],
    ]
      .filter(([, v]) => v >= n.seek)
      .sort((p, q) => q[1] - p[1]);
    for (const [type] of wants) {
      const goal = this.nearest(a, type);
      if (goal) {
        this.walk(a, Math.sign(goal.x - a.x), Math.sign(goal.y - a.y));
        return false;
      }
    }
    if (this.rng.next() < 0.5) {
      const [dx, dy] = DIRS[this.rng.int(0, 3)];
      if (this.inside(a.x + dx, a.y + dy)) this.walk(a, dx, dy);
    }
    return false;
  }

  // One square toward (dx, dy); when both are needed, one of them by chance.
  walk(a, dx, dy) {
    if (dx && dy) {
      if (this.rng.next() < 0.5) dy = 0;
      else dx = 0;
    }
    a.fromX = a.x;
    a.fromY = a.y;
    a.movedAt = this.steps * STEP;
    a.x += dx;
    a.y += dy;
  }

  // The closest trough of `type` with something in it.
  nearest(a, type) {
    let best = null;
    let bestD = Infinity;
    for (const o of this.objects) {
      if (o.type !== type || o.amount <= 0) continue;
      const d = Math.abs(o.x - a.x) + Math.abs(o.y - a.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- what drones do here

  takeGround(x, y) {
    const k = key(x, y);
    const item = this.ground[k];
    if (item) delete this.ground[k];
    delete this.laid[k];
    return item || null;
  }

  // Milk from a ready animal on (x, y), or null.
  milk(x, y) {
    const a = this.animalsAt(x, y).find((b) => b.prod >= 1 && !b.sick && !this.ranch.cfg.animals[b.type].lays);
    if (!a) return null;
    a.prod = 0;
    return this.ranch.cfg.animals[a.type].product;
  }

  pet(x, y, until) {
    const list = this.animalsAt(x, y);
    for (const a of list) {
      a.petUntil = until;
      a.mood = Math.min(100, a.mood + 10);
    }
    return list.length;
  }

  // Returns how dirty the square was (dirty squares give manure).
  clean(x, y) {
    const was = this.dirtAt(x, y);
    delete this.dirt[key(x, y)];
    return was;
  }

  // Cures the sick animals on (x, y), as many as `doses`; returns how many.
  heal(x, y, doses) {
    let n = 0;
    for (const a of this.animalsAt(x, y)) {
      if (!a.sick || n >= doses) continue;
      a.sick = false;
      a.dirtTime = 0;
      n++;
    }
    return n;
  }

  // A plank on the hole by (x, y): the fence there is whole again.
  repair(x, y) {
    const side = this.holeAt(x, y);
    if (!side) return false;
    delete this.fence[`${x},${y},${side}`];
    return true;
  }

  dirtAt(x, y) {
    return this.dirt[key(x, y)] || 0;
  }

  toSave() {
    const d = this.drone;
    const animals = this.animals.map(({ fromX, fromY, movedAt, ...a }) => a);
    const out = { rng: this.rng.state, steps: this.steps, objects: this.objects, animals, dirt: this.dirt, ground: this.ground, drone: { x: d.x, y: d.y, hands: d.hands } };
    return { ...out, laid: this.laid, fence: this.fence, runaways: this.runaways, breedT: this.breedT };
  }
}
