// One ranch area (config/ranch.json → areas): its things (basket, well, troughs, the market's stall),
// its animals and the eggs and dirt on its squares. Hunger and thirst grow; a hungry or thirsty
// animal walks to a trough that has what it needs (otherwise it steps around now and then), eats or
// drinks there, dirties the square it stands on, and gives its goods while it is happy enough (a hen
// lays an egg on its square, a cow's milk gets ready). An area is brought up to date in whole steps of
// STEP game seconds with its own random numbers, so the same program gives the same ranch at any speed
// or frame rate.
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

  // A new animal on a free square (or any square when all are taken).
  addAnimal(type, id) {
    const n = this.size;
    let x = this.rng.int(0, n - 1);
    let y = this.rng.int(0, n - 1);
    for (let i = 0; i < 20 && (this.objectAt(x, y) || this.animalsAt(x, y).length); i++) {
      x = this.rng.int(0, n - 1);
      y = this.rng.int(0, n - 1);
    }
    const a = { id, type, x, y, hunger: 20, thirst: 20, mood: 80, prod: 0, petUntil: 0, timer: this.rng.int(1, 8) };
    this.animals.push(a);
    return a;
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
    const c = this.animalCfg;
    if (!c) return;
    const n = this.ranch.cfg.needs || {};
    const crowded = this.animals.length > this.capacity();
    for (const a of this.animals) {
      a.hunger = Math.min(100, a.hunger + c.needs.hunger * STEP);
      a.thirst = Math.min(100, a.thirst + c.needs.thirst * STEP);
      const k = key(a.x, a.y);
      this.dirt[k] = Math.min(100, (this.dirt[k] || 0) + c.needs.dirt * STEP);
      let target = 100;
      if (a.hunger >= n.unhappy) target -= 35;
      if (a.thirst >= n.unhappy) target -= 35;
      if (this.dirt[k] >= n.dirty) target -= 20;
      if (crowded) target -= 20;
      if (a.petUntil > now) target = Math.min(100, target + n.petBoost);
      a.mood += clamp(target - a.mood, -n.moodSpeed * STEP, n.moodSpeed * STEP);
      // a sad, starving or very thirsty animal gives nothing
      if (a.mood >= n.sad && a.hunger < 100 && a.thirst < 100 && a.prod < 1) a.prod = Math.min(1, a.prod + (STEP / c.every) * (a.mood / 100));
      if (a.prod >= 1 && c.lays && !this.ground[k] && !this.objectAt(a.x, a.y)) {
        this.ground[k] = c.product;
        a.prod = 0;
        this.ranch.events.emit('laid', { pen: this.id, x: a.x, y: a.y, item: c.product });
      }
      if (--a.timer <= 0) {
        const base = Math.max(1, Math.round(c.step / STEP));
        a.timer = base + this.rng.int(0, Math.floor(base / 2));
        this.act(a, n);
      }
    }
  }

  // Eats or drinks where it stands, or walks to what it needs most, or steps around.
  act(a, n) {
    const here = this.objectAt(a.x, a.y);
    if (here && here.amount > 0 && ((here.type === 'FeedTrough' && a.hunger >= n.seek) || (here.type === 'WaterTrough' && a.thirst >= n.seek))) {
      here.amount--;
      if (here.type === 'FeedTrough') a.hunger = Math.max(0, a.hunger - n.fill);
      else a.thirst = Math.max(0, a.thirst - n.fill);
      return;
    }
    const wants = [
      ['FeedTrough', a.hunger],
      ['WaterTrough', a.thirst],
    ]
      .filter(([, v]) => v >= n.seek)
      .sort((p, q) => q[1] - p[1]);
    for (const [type] of wants) {
      const goal = this.nearest(a, type);
      if (goal) return this.walk(a, Math.sign(goal.x - a.x), Math.sign(goal.y - a.y));
    }
    if (this.rng.next() < 0.5) {
      const [dx, dy] = DIRS[this.rng.int(0, 3)];
      if (this.inside(a.x + dx, a.y + dy)) this.walk(a, dx, dy);
    }
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
    return item || null;
  }

  // Milk from a ready animal on (x, y), or null.
  milk(x, y) {
    const a = this.animalsAt(x, y).find((b) => b.prod >= 1 && !this.ranch.cfg.animals[b.type].lays);
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

  clean(x, y) {
    delete this.dirt[key(x, y)];
  }

  dirtAt(x, y) {
    return this.dirt[key(x, y)] || 0;
  }

  toSave() {
    const d = this.drone;
    const animals = this.animals.map(({ fromX, fromY, movedAt, ...a }) => a);
    return { rng: this.rng.state, steps: this.steps, objects: this.objects, animals, dirt: this.dirt, ground: this.ground, drone: { x: d.x, y: d.y, hands: d.hands } };
  }
}
