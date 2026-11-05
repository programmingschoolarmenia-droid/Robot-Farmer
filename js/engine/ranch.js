// Bridgy's ranch (config/ranch.json): a second world opened by the «Ռանչո» research. Its areas
// (pens with animals and the market) lie on one map, each with its own drone and script; the ranch
// has its own storage with ֏, a shop (areas, animals, bigger pens, troughs and machines, drone upgrades,
// the ranch commands themselves and boosts for the farm), prices that change every day for everyone,
// the villagers' orders and a board the drones share (grel / kardal). Drones that listen for events
// (erb) get them from their area (Pen.signal) or from the board. The loom weaves carpets (carpet.js),
// the donkey carries loads to and from the farm, the fair ends the story and New Game Plus starts over.
// Only the open world runs: the ranch moves while its screen calls update() and waits otherwise.
// Its goods count as normal points (they are gathered into the main game's Stats).
// For Runner, Drone, Inventory, the API and QuestTracker the ranch looks like a game: it has config,
// events, rng, time, inventory, stats, scripts, api, warn() and a research-like part (syntax comes
// from the farm's research, ranch commands from the shop).
import { Events } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { dayKey, dayNumber } from '../core/util.js';
import { locOf } from '../lang/errors.js';
import { makeObject } from '../lang/values.js';
import { Inventory } from './inventory.js';
import { Drone } from './drone.js';
import { Runner } from './runner.js';
import { QuestTracker } from './quests.js';
import { RanchApi } from './ranchApi.js';
import { Pen } from './animals.js';
import { EMPTY, emptyCells, cellIndex, alikeShare, carpetPrice } from './carpet.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// The farm's research or a village building gates these; on the ranch they come with the ranch.
const FREE = new Set(['canMove', 'build']);
// Shop items bought once (or level by level): they count for Perfection. Animals and troughs repeat.
const LASTING = new Set(['area', 'size', 'upgrade', 'command']);
const MAX_QUEUE = 50; // events waiting for one drone

export class Ranch {
  constructor(main, saved = {}) {
    const s = saved || {};
    this.main = main;
    this.config = main.config;
    this.isRanch = true;
    this.events = new Events();
    this.rng = new Rng(s.seed ?? (main.rng.state ^ 0x5bd1e995) >>> 0);
    this.time = s.time ?? 0;
    this.speed = 1;
    this.warned = new Set();
    this.inventory = new Inventory(this, s.storage ?? this.opening.items ?? {});
    this.owned = { ...(s.owned || {}) }; // shop id -> level (how many, for animals and troughs)
    this.tokens = { ...(s.tokens || {}) }; // troughs bought, not built yet: { FeedTrough: 1 }
    this.earned = { total: 0, day: { key: '', dram: 0 }, month: { key: '', dram: 0 }, ...(s.earned || {}) };
    this.ordersDone = s.ordersDone || 0;
    this.board = s.board || null; // today's orders: { day, list: [{ who, line, items, pay, done }] }
    this.nextAnimal = s.nextAnimal || 1;
    this.shared = s.shared || {}; // the board the drones share: { name: value } (plain JSON values)
    this.counts = { born: 0, healed: 0, returned: 0, events: 0, carpets: 0, perfect: 0, sheared: 0, honey: 0, yarn: 0, dyed: 0, fairs: 0, plus: 0, ...(s.counts || {}) }; // for the stickers
    this.boosts = { ...(s.boosts || {}) }; // eaten dishes: { speed: { item, multiplier, until } }
    this.carpets = s.carpets || []; // finished carpets not sold yet
    this.gallery = s.gallery || []; // the last carpets woven: [{ cells, sample, alike }]
    this.favorite = s.favorite || null; // the carpet on the player card (its letters)
    this.perfect = { total: 0, day: { key: '', n: 0 }, month: { key: '', n: 0 }, ...(s.perfect || {}) }; // perfect carpets by their level
    this.carpetBoard = s.carpetBoard || null; // today's carpet orders: { day, list: [{ sample, pay, taken }] }
    this.donkey = s.donkey || null; // the donkey's trip: { kind, item, n, pen, start, until }
    this.plus = s.plus || 0; // New Game Plus level
    this.fairDone = !!s.fairDone; // the fair of this round
    this.fairs = s.fairs || 0; // fairs of all rounds
    this.keptProgress = s.keptProgress || 0; // Perfection: what was bought before New Game Plus
    this.challenge = { week: '', scripts: {}, best: 0, bestCode: '', prev: null, ...(s.challenge || {}) }; // the ranch's weekly challenge
    this.contestPrizeWeek = s.contestPrizeWeek || ''; // the carpet contest week whose prizes were looked for
    this.functionGate = new Map();
    for (const item of this.shop) for (const f of item.grants || []) this.functionGate.set(f, item.id);
    const layout = (this.cfg.map && this.cfg.map.layout) || [];
    this.world = { width: (layout[0] || []).length || 1, height: layout.length || 1 }; // places per row, rows
    this.scripts = (s.scripts || []).map((x) => ({ name: x.name, code: x.code }));
    this.pens = new Map();
    for (const id of this.areaIds()) if (this.isOpen(id)) this.openArea(id, (s.pens || {})[id]);
    if (!s.pens) for (const [type, n] of Object.entries(this.opening.animals || {})) for (let i = 0; i < n; i++) this.addAnimal(type);
    this.activeScript = this.scripts.some((x) => x.name === s.activeScript) ? s.activeScript : this.scripts.length ? this.scripts[0].name : null;
    this.api = new RanchApi(this);
    this.quests = new QuestTracker(this, s.quests || {}, this.cfg.quests || []);
  }

  get cfg() {
    return this.config.ranch || {};
  }

  get opening() {
    return this.cfg.start || {};
  }

  get shop() {
    return this.cfg.shop || [];
  }

  get stats() {
    return this.main.stats;
  }

  get village() {
    return this.main.village;
  }

  // The farm's settings with the ranch's storage order (for the storage panel).
  get settings() {
    const s = this.config.settings;
    return { ...s, items: { ...s.items, order: Object.keys(this.cfg.items || {}) } };
  }

  // ---------------------------------------------------------------- the map and its areas

  areaIds() {
    return ((this.cfg.map && this.cfg.map.layout) || []).flat();
  }

  // Where an area lies on the map: its column and row (the first row on top).
  cell(id) {
    const layout = this.cfg.map.layout;
    const row = layout.findIndex((r) => r.includes(id));
    return { col: layout[row].indexOf(id), row };
  }

  isOpen(id) {
    const a = this.cfg.areas[id];
    return !!a && a.available !== false && ((this.opening.areas || []).includes(id) || this.level(id) > 0);
  }

  // The area with the stall: only its drone trades.
  get marketId() {
    return Object.keys(this.cfg.areas).find((id) => (this.cfg.areas[id].objects || {}).Stall);
  }

  openArea(id, saved) {
    const cfg = this.cfg.areas[id];
    const pen = new Pen(this, id, saved, saved ? 0 : Math.floor(this.rng.next() * 4294967296)); // (a saved area has its own)
    const d = new Drone(this, 0, saved && saved.drone);
    d.pen = pen;
    d.hat = this.main.mainDrone.hat;
    d.hands = { ...((saved && saved.drone && saved.drone.hands) || {}) };
    pen.drone = d;
    pen.runner = new Runner(this, d, cfg.script);
    if (!this.scripts.some((x) => x.name === cfg.script)) this.scripts.push({ name: cfg.script, code: cfg.code || '' });
    this.pens.set(id, pen);
    return pen;
  }

  // The area of a script tab (null for helper files).
  penOfScript(name) {
    for (const p of this.pens.values()) if (p.cfg.script === name) return p;
    return null;
  }

  penOf(animal) {
    for (const p of this.pens.values()) if (p.cfg.animal === animal) return p;
    return null;
  }

  penSize(id) {
    const sizes = this.cfg.areas[id].sizes || [1];
    const item = this.shop.find((x) => x.kind === 'size' && x.area === id);
    return sizes[Math.min(item ? this.level(item.id) : 0, sizes.length - 1)];
  }

  addAnimal(type) {
    const pen = this.penOf(type);
    if (!pen) return null;
    pen.sync(this.time);
    return pen.addAnimal(type, this.nextAnimal++);
  }

  animalCount() {
    let n = 0;
    for (const p of this.pens.values()) n += p.animals.length;
    return n;
  }

  // ---------------------------------------------------------------- research-like part

  get research() {
    return this;
  }

  level(id) {
    return this.owned[id] || 0;
  }

  hasSyntax(feature) {
    return this.main.research.hasSyntax(feature);
  }

  // Commands sold in the shop when bought; the farm's other commands follow its research.
  hasFunction(name) {
    const gate = this.functionGate.get(name);
    if (gate) return this.level(gate) > 0;
    return FREE.has(name) || this.main.research.hasFunction(name);
  }

  hasHat(name) {
    return this.main.research.hasHat(name);
  }

  nodeForSyntax(feature) {
    return this.main.research.nodeForSyntax(feature);
  }

  nodeForFunction(name) {
    return this.functionGate.get(name) || this.main.research.nodeForFunction(name);
  }

  // Changes when anything is bought here or researched on the farm (compiled programs are checked again).
  totalLevels() {
    return this.main.research.totalLevels() * 1000 + Object.values(this.owned).reduce((a, b) => a + b, 0);
  }

  handsCapacity() {
    const h = this.cfg.hands || [3];
    return h[Math.min(this.level('Hands'), h.length - 1)];
  }

  boost() {
    return 1;
  }

  // The speed of one drone at its own time: an eaten dish, and the bees' stings near a hive until the
  // first honey gave the beekeeper's hat (by the drone's time, so at any frame rate).
  droneRate(d) {
    let rate = 1;
    const b = this.boosts.speed;
    if (b && d.time < b.until) rate *= b.multiplier;
    const hive = this.cfg.hive || {};
    if (d.pen && d.pen.cfg.stings && !this.noStings() && d.pen.hiveNear(d.x, d.y, hive.stingRadius ?? 1)) rate *= hive.sting ?? 1;
    return rate;
  }

  noStings() {
    return (this.main.flags.hats || []).includes(this.hats.honey);
  }

  get hats() {
    return (this.config.events || {}).ranchHats || {};
  }

  // Drones in each area (the shop's «one more drone» adds one everywhere).
  maxDrones() {
    return 1 + this.level('Drones');
  }

  // How the season and the weather change the animals (ranch.json → seasons; 1 = no change).
  seasonFactors() {
    const st = this.main.calendar.state;
    const out = { hunger: 1, thirst: 1, dirt: 1, breed: 1, heat: 1, wool: 1, honey: 1 };
    const harder = ((this.cfg.plus || {}).needs ?? 1) ** this.plus; // New Game Plus
    for (const k of ['hunger', 'thirst', 'dirt', 'heat']) out[k] *= harder;
    if (!st) return out;
    const c = this.cfg.seasons || {};
    const fest = (st.festival && st.festival.ranch) || {};
    for (const part of [c[st.season], c[st.weather], fest]) for (const [k, v] of Object.entries(part || {})) if (typeof v === 'number') out[k] *= v;
    return out;
  }

  // An event for the drones listening for it (erb) in one area, or everywhere (penId null).
  signal(penId, name, data, t) {
    for (const p of penId ? [this.pens.get(penId)] : this.pens.values()) {
      if (!p || p.runner.state === 'idle') continue;
      for (const d of p.runner.drones) {
        const fn = d.listeners && d.listeners.get(name);
        if (!fn) continue;
        if (d.queue.length >= MAX_QUEUE) this.warn('ranch_eventsFull', { n: MAX_QUEUE }, null, d);
        else {
          this.counts.events++;
          p.runner.queueEvent(d, fn, Object.assign(makeObject(), data), t);
        }
      }
    }
  }

  // The shared board (copies go in and out, so a drone never changes another one's value).
  write(name, value, t) {
    this.shared[name] = value === undefined ? null : JSON.parse(JSON.stringify(value));
    this.signal(null, 'grum', { anun: name }, t);
  }

  read(name) {
    return Object.prototype.hasOwnProperty.call(this.shared, name) ? JSON.parse(JSON.stringify(this.shared[name])) : null;
  }

  afterAction(drone) {
    drone.actions++;
  }

  warn(code, params, node, drone) {
    const loc = locOf(node);
    const key = `${code}:${loc ? loc.line : ''}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.events.emit('warning', { code, params, loc, module: node && node._mod, drone: drone ? drone.id : 0, pen: drone && drone.pen ? drone.pen.id : null });
  }

  script(name) {
    return this.scripts.find((x) => x.name === name);
  }

  setScriptCode(name, code) {
    const x = this.script(name);
    if (x) x.code = code;
  }

  // ---------------------------------------------------------------- running

  // For the control bar and the quests: 'running' while any area runs, 'paused', or 'idle'.
  get runner() {
    const state = this.state();
    return { state, isActive: () => state !== 'idle' };
  }

  state() {
    let paused = false;
    for (const p of this.pens.values()) {
      if (p.runner.state === 'running') return 'running';
      if (p.runner.state === 'paused') paused = true;
    }
    return paused ? 'paused' : 'idle';
  }

  start(id) {
    const p = this.pens.get(id);
    if (!p) return { ok: false };
    p.drone.hat = this.main.mainDrone.hat;
    return p.runner.start(p.cfg.script);
  }

  startAll() {
    for (const [id, p] of this.pens) if (p.runner.state === 'idle') this.start(id);
  }

  stop(id, reason = 'user') {
    const p = this.pens.get(id);
    if (p) p.runner.stop(reason);
  }

  stopAll(reason = 'user', silent = false) {
    for (const p of this.pens.values()) p.runner.stop(reason, silent);
  }

  pauseAll() {
    for (const p of this.pens.values()) p.runner.pause();
  }

  resumeAll() {
    for (const p of this.pens.values()) p.runner.resume();
  }

  update(realDt) {
    this.main.calendar.update(this.main.time);
    const g = this.config.settings.game || {};
    const dt = Math.min(realDt, g.maxFrameSeconds ?? 0.1) * this.speed;
    this.main.playSeconds += Math.min(realDt, 0.25);
    const runners = [...this.pens.values()].map((p) => p.runner);
    if (runners.some((r) => r.state === 'paused')) {
      // paused: time moves only up to where the Step button got
      const goal = Math.max(this.time, ...runners.map((r) => (r.state === 'paused' && r.stepTarget !== null ? r.stepTarget : this.time)));
      if (goal > this.time) this.time = Math.min(goal, this.time + dt);
      return;
    }
    this.time = Math.max(this.time, this.runDrones(runners, this.time + dt, g.frameBudgetMs ?? 12));
  }

  // Steps the drone with the smallest game time of all areas, again and again (the rule Runner.update
  // uses inside one area), so the areas take turns the same way at any speed. Returns the time reached.
  runDrones(runners, target, budgetMs) {
    const deadline = nowMs() + budgetMs;
    let steps = 0;
    for (;;) {
      let best = null;
      let owner = null;
      for (const r of runners) {
        if (r.state !== 'running') continue;
        for (const d of r.drones) {
          if (d.state === 'running' && d.time < target && (!best || d.time < best.time)) {
            best = d;
            owner = r;
          }
        }
      }
      if (!best) break;
      this.donkeyArrives(best.time);
      this.wake(runners, best.time);
      this.stepping = best;
      owner.stepDrone(best);
      if ((++steps & 31) === 0 && nowMs() > deadline) {
        let t = target;
        for (const r of runners) if (r.state === 'running') for (const d of r.drones) if (d.state === 'running') t = Math.min(t, d.time);
        return t;
      }
    }
    for (const r of runners) if (r.state === 'running') for (const d of r.drones) if (d.state === 'waiting' && d.time < target) d.time = target;
    this.donkeyArrives(target);
    this.wake(runners, target);
    return this.wakeTime(runners, target);
  }

  // Areas whose drones only listen are brought up to t, so their events come in time order.
  wake(runners, t) {
    for (const r of runners) if (r.state === 'running' && r.drones.some((d) => d.state === 'listening')) r.root.pen.sync(t);
  }

  // A handler that an event started behind `target` still has to run: time stops there this frame.
  wakeTime(runners, target) {
    let t = target;
    for (const r of runners) if (r.state === 'running') for (const d of r.drones) if (d.state === 'running') t = Math.min(t, d.time);
    return t;
  }

  syncAll() {
    for (const p of this.pens.values()) p.sync(this.time);
  }

  // ---------------------------------------------------------------- the shop

  shopItem(id) {
    return this.shop.find((x) => x.id === id) || null;
  }

  // The name shown for a shop item: its own, or its commands' (e.g. «gnel()»).
  shopName(item) {
    return item.name || (item.grants || []).map((f) => `${this.api.displayName(f)}()`).join(', ');
  }

  maxLevel(item) {
    if (item.costs) return item.costs.length;
    return LASTING.has(item.kind) ? 1 : Infinity;
  }

  nextCost(id) {
    const item = this.shopItem(id);
    const cost = item.costs ? item.costs[this.level(id)] : item.cost;
    return Math.round(cost * ((this.cfg.plus || {}).shop ?? 1) ** this.plus); // (New Game Plus costs more)
  }

  // The first thing that must be bought before this item, or null.
  missingNeed(item) {
    return [].concat(item.needs || []).find((id) => !this.level(id)) || null;
  }

  // 'owned' | 'soon' | 'locked' (buy `needs` first) | 'full' (no room for the animal) | 'affordable' | 'expensive'
  shopState(id) {
    const item = this.shopItem(id);
    if (!item) return 'locked';
    if (item.available === false) return 'soon';
    if (this.level(id) >= this.maxLevel(item)) return 'owned';
    if (this.missingNeed(item)) return 'locked';
    if (item.kind === 'animal') {
      const pen = this.penOf(item.animal);
      if (!pen || pen.animals.length >= pen.capacity()) return 'full';
    }
    return this.inventory.get('Dram') >= this.nextCost(id) ? 'affordable' : 'expensive';
  }

  // What it does happens before the ֏ are paid, so whoever listens to the storage sees it done.
  buy(id) {
    const state = this.shopState(id);
    if (state !== 'affordable') return { ok: false, reason: state };
    const item = this.shopItem(id);
    const cost = this.nextCost(id);
    this.owned[id] = this.level(id) + 1;
    if (item.kind === 'area') {
      this.openArea(id);
      for (let i = 0; i < (item.animals || 0); i++) this.addAnimal(this.cfg.areas[id].animal);
    } else if (item.kind === 'animal') this.addAnimal(item.animal);
    else if (item.kind === 'trough' || item.kind === 'machine') this.tokens[id] = (this.tokens[id] || 0) + 1;
    else if (item.kind === 'boost') this.main.addBoost(item.boost.kind, 'Dram', item.boost.multiplier, item.boost.seconds);
    if (item.grants) this.api.compiled.clear();
    this.inventory.add('Dram', -cost, 'shop');
    this.events.emit('shop', { id, item, level: this.level(id) });
    this.main.events.emit('ranch', { shop: id });
    return { ok: true };
  }

  // Perfection: the lasting things bought (levels count one by one) of all that can be bought now, and
  // the fair. New Game Plus never takes back what was reached.
  progress() {
    let value = 0;
    let max = 0;
    for (const item of this.shop) {
      if (item.available === false || !LASTING.has(item.kind)) continue;
      max += this.maxLevel(item);
      value += Math.min(this.level(item.id), this.maxLevel(item));
    }
    if (this.cfg.fair) {
      max++;
      if (this.fairs > 0) value++;
    }
    return { value: Math.max(value, this.keptProgress), max };
  }

  // ---------------------------------------------------------------- the market

  today() {
    return dayKey(this.main.stats.clock(), (this.config.settings.leaderboard || {}).timeZone);
  }

  // Today's price of an item in ֏ (selling goods, buying feed): the same for everyone on a day.
  price(item, day = this.today()) {
    const c = (this.cfg.items || {})[item];
    const base = c && (c.sell ?? c.buy);
    if (!base) return 0;
    const r = new Rng(dayNumber(day) * 131 + Object.keys(this.cfg.items).indexOf(item) * 7919 + 1).next();
    const spread = (this.cfg.prices && this.cfg.prices.spread) ?? 0;
    const bonus = c.sell ? this.goodsFactor() * ((((this.festivalToday() || {}).ranch || {}).sell || {})[item] ?? 1) : 1;
    return Math.max(1, Math.round(base * (1 + spread * (2 * r - 1)) * bonus));
  }

  // Goods pay more in New Game Plus.
  goodsFactor() {
    return ((this.cfg.plus || {}).goods ?? 1) ** this.plus;
  }

  festivalToday() {
    return (this.main.calendar.state || {}).festival || null;
  }

  sell(item, n = Infinity) {
    const c = (this.cfg.items || {})[item];
    if (!c || !c.sell) return { ok: false };
    const k = Math.min(n, Math.floor(this.inventory.get(item)));
    if (k <= 0) return { ok: true, n: 0, dram: 0 };
    const dram = k * this.price(item);
    this.inventory.add(item, -k, 'sell');
    this.earn(dram, 'sell');
    this.events.emit('sold', { item, n: k, dram });
    return { ok: true, n: k, dram };
  }

  // Feed, medicine or planks for ֏: as much as there is money for.
  buyItem(item, n) {
    const c = (this.cfg.items || {})[item];
    if (!c || !c.buy) return { ok: false };
    const price = this.price(item);
    const k = Math.min(n, Math.floor(this.inventory.get('Dram') / price));
    if (k > 0) {
      this.inventory.add('Dram', -k * price, 'market');
      this.inventory.add(item, k, 'market');
    }
    return { ok: true, n: k };
  }

  // The farm's cart: config/ranch.json → cart, e.g. 10 000 farm Hay for one Bale (`need`: for one).
  bring(item, n) {
    const cost = (this.cfg.cart || {})[item];
    if (!cost) return { ok: false };
    const farm = this.main.inventory;
    const k = Math.min(n, ...Object.entries(cost).map(([it, m]) => Math.floor(farm.get(it) / m)));
    if (k > 0) {
      for (const [it, m] of Object.entries(cost)) farm.add(it, -k * m, 'ranch');
      this.inventory.add(item, k, 'cart');
    }
    return { ok: true, n: k, need: cost };
  }

  // Ranch goods to the farm's storage (ranch.json → ship: e.g. one Manure → 3 Fertilizer). A move,
  // not a harvest: the farm's points do not count them again.
  ship(item, n) {
    const to = (this.cfg.ship || {})[item];
    if (!to) return { ok: false };
    const k = Math.min(n, Math.floor(this.inventory.get(item)));
    if (k > 0) {
      this.inventory.add(item, -k, 'ship');
      for (const [it, m] of Object.entries(to)) this.main.inventory.add(it, k * m, 'transfer');
    }
    return { ok: true, n: k };
  }

  // What a villager pays for a grown animal: its price, more for the rare colour.
  animalPrice(a) {
    const c = this.cfg.animals[a.type];
    return Math.round((c.price || 0) * (c.rare && a.color === c.rare ? ((this.cfg.needs || {}).rarePrice ?? 1) : 1));
  }

  // Finds an animal by id in every area: { pen, a }.
  findAnimal(id) {
    for (const pen of this.pens.values()) {
      const a = pen.animals.find((x) => x.id === id);
      if (a) return { pen, a };
    }
    return null;
  }

  sellAnimal(id) {
    const f = this.findAnimal(id);
    if (!f) return { ok: false, reason: 'noAnimal' };
    f.pen.sync(this.time);
    if (f.pen.young(f.a, this.time)) return { ok: false, reason: 'young' };
    const dram = this.animalPrice(f.a);
    f.pen.animals.splice(f.pen.animals.indexOf(f.a), 1);
    this.earn(dram, 'animal');
    this.events.emit('sold', { item: 'Dram', n: 1, dram, animal: f.a.type });
    return { ok: true, dram };
  }

  earn(dram, source) {
    this.inventory.add('Dram', dram, source);
    const day = this.today();
    const e = this.earned;
    if (e.day.key !== day) e.day = { key: day, dram: 0 };
    if (e.month.key !== day.slice(0, 6)) e.month = { key: day.slice(0, 6), dram: 0 };
    e.total += dram;
    e.day.dram += dram;
    e.month.dram += dram;
    this.main.events.emit('ranch', { earned: dram });
  }

  // ---------------------------------------------------------------- carpets

  get carpetCfg() {
    return this.cfg.carpets || {};
  }

  sample(id) {
    return (this.carpetCfg.samples || []).find((x) => x.id === id) || null;
  }

  // The loom and its area: { pen, loom }, or null while the sheep's place is closed.
  loom() {
    for (const pen of this.pens.values()) {
      const loom = pen.objects.find((o) => o.type === 'Loom');
      if (loom) return { pen, loom };
    }
    return null;
  }

  // Today's carpet orders, made on the first look of a new day (the festival's sample comes on top).
  carpetOrders() {
    const day = this.today();
    if (!this.carpetBoard || this.carpetBoard.day !== day) this.carpetBoard = this.makeCarpetBoard(day);
    return this.carpetBoard;
  }

  makeCarpetBoard(day) {
    const cfg = this.carpetCfg;
    const rng = new Rng(Number(day) + 29);
    const samples = (cfg.samples || []).filter((x) => !x.festival);
    const picked = [];
    for (const levels of cfg.buckets || []) {
      const pool = samples.filter((x) => levels.includes(x.level));
      if (pool.length) picked.push(pool[rng.int(0, pool.length - 1)]);
    }
    const f = this.festivalToday();
    const special = f && f.sample && this.sample(f.sample);
    const list = picked.slice(0, cfg.perDay ?? 3).concat(special ? [special] : []);
    return { day, list: list.map((x) => ({ sample: x.id, pay: Math.round(x.pay * this.goodsFactor()), taken: false })) };
  }

  // A carpet on the loom: an order (index i of today's) or a free one (no i). Returns { ok, reason }.
  startCarpet(loom, i) {
    if (loom.carpet) return { ok: false, reason: 'busy' };
    let order = {};
    if (i !== null) {
      const q = this.carpetOrders().list[i];
      if (!q) return { ok: false, reason: 'noOrder' };
      if (q.taken) return { ok: false, reason: 'taken' };
      q.taken = true;
      order = q;
    }
    const n = this.carpetCfg.size ?? 9;
    loom.carpet = { cells: emptyCells(n), knots: 0, soft: 0, sample: order.sample || null, pay: order.pay || 0 };
    return { ok: true };
  }

  // One knot (a knot can't be changed): { ok, reason, item }. The last knot finishes the carpet.
  knot(pen, loom, x, y, color, t) {
    const cfg = this.carpetCfg;
    const n = cfg.size ?? 9;
    const c = loom.carpet;
    const yarn = (cfg.palette || {})[color];
    if (!yarn) return { ok: false, reason: 'color' };
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) return { ok: false, reason: 'outside' };
    const i = cellIndex(n, x, y);
    if (c.cells[i] !== EMPTY) return { ok: false, reason: 'taken' };
    const inside = loom.inside || {};
    if (!inside[yarn.yarn]) return { ok: false, reason: 'yarn', item: yarn.yarn };
    inside[yarn.yarn]--;
    if (!inside[yarn.yarn]) delete inside[yarn.yarn];
    c.cells = c.cells.slice(0, i) + yarn.letter + c.cells.slice(i + 1);
    c.knots++;
    if (yarn.like) c.soft++;
    if (c.knots === n * n) this.finishCarpet(pen, loom, t);
    return { ok: true };
  }

  finishCarpet(pen, loom, t) {
    const cfg = this.carpetCfg;
    const c = loom.carpet;
    const sample = c.sample && this.sample(c.sample);
    loom.carpet = null;
    const done = { cells: c.cells, sample: c.sample, soft: c.soft, pay: c.pay, alike: sample ? alikeShare(c.cells, sample, cfg.palette) : null };
    done.price = Math.round(carpetPrice(cfg, done) * (c.pay ? 1 : this.goodsFactor()));
    this.carpets.push(done);
    this.inventory.add('Carpet', 1, 'loom');
    this.gallery.push({ cells: done.cells, sample: done.sample, alike: done.alike });
    this.gallery.splice(0, Math.max(0, this.gallery.length - (cfg.gallery ?? 12)));
    this.counts.carpets++;
    if (done.alike === 1) this.perfectCarpet(sample.level);
    this.main.earnHat(this.hats.carpet);
    this.events.emit('carpet', { pen: pen.id, x: loom.x, y: loom.y, alike: done.alike, price: done.price, sample: done.sample });
    this.main.events.emit('ranch', { carpet: done.alike });
    pen.signal('gorg', { tokos: done.alike === null ? null : Math.round(done.alike * 100), gin: done.price }, t);
  }

  // The leaderboard's list: perfect carpets, a hard sample counts more.
  perfectCarpet(level) {
    const day = this.today();
    const p = this.perfect;
    if (p.day.key !== day) p.day = { key: day, n: 0 };
    if (p.month.key !== day.slice(0, 6)) p.month = { key: day.slice(0, 6), n: 0 };
    p.total += level;
    p.day.n += level;
    p.month.n += level;
    this.counts.perfect++;
  }

  // Sells every finished carpet: { n, dram }.
  sellCarpets() {
    const list = this.carpets.splice(0);
    const dram = list.reduce((a, c) => a + c.price, 0);
    if (list.length) {
      this.inventory.add('Carpet', -list.length, 'sell');
      this.earn(dram, 'carpet');
      this.events.emit('sold', { item: 'Carpet', n: list.length, dram });
    }
    return { n: list.length, dram };
  }

  // Goods from a machine: the first honey gives the beekeeper's hat (and the stings stop).
  made(item, machine) {
    if (machine === 'Wheel') this.counts.yarn++;
    if (machine === 'DyePot') this.counts.dyed++;
    if (item === 'Honey') {
      this.counts.honey++;
      this.main.earnHat(this.hats.honey);
    }
    this.main.events.emit('ranch', { made: item });
  }

  // ---------------------------------------------------------------- dishes, the donkey, the festival's hunt

  // A dish from the storage: the ranch's drones are faster for its seconds (eating again adds more).
  eat(item, t) {
    const cfg = (this.cfg.dishes || {})[item];
    if (!cfg) return { ok: false, reason: 'notDish' };
    if (this.inventory.get(item) < 1) return { ok: false, reason: 'none' };
    this.inventory.add(item, -1, 'eat');
    const b = this.boosts.speed;
    this.boosts.speed = { item, multiplier: cfg.multiplier, until: Math.max(b ? b.until : 0, t) + cfg.seconds };
    this.events.emit('boost', { kind: 'speed', item, until: this.boosts.speed.until });
    return { ok: true };
  }

  // Sends the donkey: 'bring' from the farm (at the cart's rates) or 'ship' to the farm. The goods leave at
  // once and arrive at the end of the trip. Returns { ok, reason, n, need }.
  sendDonkey(pen, kind, item, n, t) {
    if (this.donkey) return { ok: false, reason: 'busy' };
    const cfg = this.cfg.donkey || {};
    const want = Math.min(n, cfg.load ?? 100);
    let k = 0;
    if (kind === 'bring') {
      const cost = (this.cfg.cart || {})[item];
      if (!cost) return { ok: false, reason: 'cantBring' };
      const farm = this.main.inventory;
      k = Math.min(want, ...Object.entries(cost).map(([it, m]) => Math.floor(farm.get(it) / m)));
      if (k <= 0) return { ok: false, reason: 'short', need: cost };
      for (const [it, m] of Object.entries(cost)) farm.add(it, -k * m, 'ranch');
    } else {
      if (!(this.cfg.ship || {})[item]) return { ok: false, reason: 'cantShip' };
      k = Math.min(want, Math.floor(this.inventory.get(item)));
      if (k <= 0) return { ok: false, reason: 'none' };
      this.inventory.add(item, -k, 'ship');
    }
    this.donkey = { kind, item, n: k, pen: pen.id, start: t, until: t + (cfg.seconds ?? 20) };
    this.events.emit('donkey', { kind, item, n: k });
    return { ok: true, n: k };
  }

  // The trip ended by time t: the goods arrive and the donkey's area hears it (by time, not by frames).
  donkeyArrives(t) {
    const d = this.donkey;
    if (!d || t < d.until) return;
    this.donkey = null;
    if (d.kind === 'bring') this.inventory.add(d.item, d.n, 'cart');
    else for (const [it, m] of Object.entries(this.cfg.ship[d.item])) this.main.inventory.add(it, d.n * m, 'transfer');
    this.events.emit('donkey', { arrived: true, item: d.item, n: d.n });
    this.signal(d.pen, 'esh', { ir: this.api.enums.Items.get(d.item), qanak: d.n }, d.until);
  }

  // The hidden objects of the running festival in this area (null without one).
  huntSpots(pen) {
    const f = this.main.festivals.active;
    if (!f) return null;
    if (!pen.spots || pen.spots.key !== f.key) pen.spots = { key: f.key, list: [] };
    const want = Math.min(this.main.festivals.cfg.hidden ?? 3, pen.size * pen.size);
    const list = (pen.spots.list = pen.spots.list.filter(([x, y]) => pen.inside(x, y)));
    while (list.length < want) list.push([pen.rng.int(0, pen.size - 1), pen.rng.int(0, pen.size - 1)]);
    return list;
  }

  // hototel() here: steps to the nearest hidden object, or null.
  huntDistance(pen, d) {
    const list = this.huntSpots(pen);
    return list ? Math.min(...list.map(([x, y]) => Math.abs(x - d.x) + Math.abs(y - d.y))) : null;
  }

  // porel() here: 'found', 'miss' (the nearest one runs away) or null without a festival.
  huntDig(pen, x, y) {
    const list = this.huntSpots(pen);
    if (!list) return null;
    const near = (p) => Math.abs(p[0] - x) + Math.abs(p[1] - y);
    const i = list.reduce((best, p, j) => (near(p) < near(list[best]) ? j : best), 0);
    const hit = near(list[i]) === 0;
    list.splice(i, 1);
    if (hit) this.main.festivals.collect(this.main.festivals.active, x, y);
    else this.main.events.emit('festivalMiss', { x, y });
    return hit ? 'found' : 'miss';
  }

  // ---------------------------------------------------------------- the fair and New Game Plus

  // The market drone gives the fair its goods and one carpet alike enough.
  deliverFair() {
    const f = this.cfg.fair || {};
    if (this.fairDone) return { ok: false, reason: 'done' };
    if (!this.inventory.canAfford(f.goods)) {
      const missing = Object.fromEntries(this.inventory.missing(f.goods).map((m) => [m.item, m.need - Math.floor(m.have)]));
      return { ok: false, reason: 'missing', missing };
    }
    const i = this.carpets.findIndex((c) => c.alike !== null && c.alike >= f.carpet);
    if (i < 0) return { ok: false, reason: 'carpet' };
    this.carpets.splice(i, 1);
    this.inventory.add('Carpet', -1, 'fair');
    this.inventory.pay(f.goods, 'fair');
    this.fairDone = true;
    this.fairs++;
    this.counts.fairs++;
    this.earn(Math.round(f.pay * this.goodsFactor()), 'fair');
    this.main.earnHat(this.hats.fair);
    this.events.emit('fair', {});
    this.main.events.emit('ranch', { fair: true });
    return { ok: true };
  }

  // After the fair: animals, places, ֏, goods and purchases start over, harder and paying more. The
  // code, the gallery and all lifetime numbers stay.
  restart() {
    if (!this.fairDone) return { ok: false };
    this.stopAll('restart', true);
    this.keptProgress = this.progress().value;
    this.plus++;
    this.counts.plus++;
    this.fairDone = false;
    this.owned = {};
    this.tokens = {};
    this.board = null;
    this.carpetBoard = null;
    this.shared = {};
    this.boosts = {};
    this.donkey = null;
    this.carpets = [];
    this.inventory = new Inventory(this, this.opening.items ?? {});
    this.pens = new Map();
    for (const id of this.areaIds()) if (this.isOpen(id)) this.openArea(id);
    for (const [type, n] of Object.entries(this.opening.animals || {})) for (let i = 0; i < n; i++) this.addAnimal(type);
    this.activeScript = (this.pens.values().next().value || { cfg: {} }).cfg.script || this.activeScript;
    this.api.compiled.clear();
    this.events.emit('restart', {});
    this.main.events.emit('ranch', { plus: this.plus });
    return { ok: true };
  }

  // Goods were put in a basket (stickers count them).
  unloaded(pen, drone) {
    this.events.emit('unload', { pen: pen.id, x: drone.x, y: drone.y });
    this.main.events.emit('ranch', { unloaded: pen.id });
  }

  villager(i) {
    return (((this.config.village || {}).requests || {}).villagers || [])[i] || { name: '?', face: 'girl' };
  }

  // How many animals give `item` (orders ask only for what the ranch makes).
  producers(item) {
    let n = 0;
    for (const p of this.pens.values()) if (p.animalCfg && p.animalCfg.product === item) n += p.animals.length;
    return n;
  }

  // Today's orders, made on the first look of a new day.
  orders() {
    const day = this.today();
    if (!this.board || this.board.day !== day) this.board = this.makeBoard(day);
    return this.board;
  }

  makeBoard(day) {
    const o = this.cfg.orders || {};
    const rng = new Rng(Number(day) + 17);
    const goods = Object.keys(o.base || {}).filter((item) => this.producers(item) > 0);
    const people = (((this.config.village || {}).requests || {}).villagers || []).map((_, i) => i);
    const list = [];
    while (list.length < (o.perDay ?? 3) && goods.length && people.length) {
      const who = people.splice(rng.int(0, people.length - 1), 1)[0];
      const pick = goods.length > 1 && rng.chance(0.5) ? goods : [goods[rng.int(0, goods.length - 1)]];
      const items = {};
      for (const item of pick) items[item] = Math.max(1, Math.round(o.base[item] * Math.max(1, this.producers(item) / 2) * rng.range(0.7, 1.3)));
      let value = Object.entries(items).reduce((a, [item, n]) => a + n * (this.cfg.items[item].sell || 0), 0);
      const q = { who, line: rng.int(0, Math.max(0, (o.lines || []).length - 1)), items, pay: 0, done: false };
      const kinds = [...this.pens.values()].filter((p) => p.animalCfg && (p.animalCfg.colors || []).length).map((p) => p.cfg.animal);
      if (kinds.length && rng.chance(o.animals ?? 0)) {
        const type = kinds[rng.int(0, kinds.length - 1)];
        const colors = this.cfg.animals[type].colors;
        q.animal = { type, color: colors[rng.int(0, colors.length - 1)] };
        value += this.animalPrice(q.animal);
      }
      q.pay = Math.round(value * (o.pay ?? 1.5));
      list.push(q);
    }
    return { day, list };
  }

  deliver(i) {
    const q = this.orders().list[i];
    if (!q) return { ok: false, reason: 'noOrder' };
    if (q.done) return { ok: false, reason: 'done' };
    if (!this.inventory.canAfford(q.items)) {
      const missing = Object.fromEntries(this.inventory.missing(q.items).map((m) => [m.item, m.need - Math.floor(m.have)]));
      return { ok: false, reason: 'missing', missing };
    }
    let found = null;
    if (q.animal) {
      const pen = this.penOf(q.animal.type);
      if (pen) pen.sync(this.time);
      const a = pen && pen.animals.find((x) => x.color === q.animal.color && !pen.young(x, this.time));
      if (!a) return { ok: false, reason: 'noAnimal' };
      found = { pen, a };
    }
    if (found) found.pen.animals.splice(found.pen.animals.indexOf(found.a), 1);
    this.inventory.pay(q.items, 'order');
    q.done = true;
    this.ordersDone++;
    this.earn(q.pay, 'order');
    this.events.emit('order', { index: i, pay: q.pay });
    return { ok: true, pay: q.pay };
  }

  // ---------------------------------------------------------------- saving

  toSave() {
    const pens = {};
    for (const [id, p] of this.pens) pens[id] = p.toSave();
    return {
      seed: this.rng.state,
      time: this.time,
      storage: this.inventory.toSave(),
      owned: this.owned,
      tokens: this.tokens,
      earned: this.earned,
      ordersDone: this.ordersDone,
      board: this.board,
      nextAnimal: this.nextAnimal,
      shared: this.shared,
      counts: this.counts,
      boosts: this.boosts,
      carpets: this.carpets,
      gallery: this.gallery,
      favorite: this.favorite,
      perfect: this.perfect,
      carpetBoard: this.carpetBoard,
      donkey: this.donkey,
      plus: this.plus,
      fairDone: this.fairDone,
      fairs: this.fairs,
      keptProgress: this.keptProgress,
      challenge: this.challenge,
      contestPrizeWeek: this.contestPrizeWeek,
      scripts: this.scripts.map((x) => ({ name: x.name, code: x.code })),
      activeScript: this.activeScript,
      pens,
      quests: this.quests.toSave(),
    };
  }
}
