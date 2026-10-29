// Bridgy's ranch (config/ranch.json): a second world opened by the «Ռանչո» research. Its areas
// (pens with animals and the market) lie on one map, each with its own drone and script; the ranch
// has its own storage with ֏, a shop (areas, animals, bigger pens, troughs, drone upgrades and the
// ranch commands themselves), prices that change every day for everyone, and the villagers' orders.
// Only the open world runs: the ranch moves while its screen calls update() and waits otherwise.
// Its goods count as normal points (they are gathered into the main game's Stats).
// For Runner, Drone, Inventory, the API and QuestTracker the ranch looks like a game: it has config,
// events, rng, time, inventory, stats, scripts, api, warn() and a research-like part (syntax comes
// from the farm's research, ranch commands from the shop).
import { Events } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { dayKey, dayNumber } from '../core/util.js';
import { locOf } from '../lang/errors.js';
import { Inventory } from './inventory.js';
import { Drone } from './drone.js';
import { Runner } from './runner.js';
import { QuestTracker } from './quests.js';
import { RanchApi } from './ranchApi.js';
import { Pen } from './animals.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// The farm's research or a village building gates these; on the ranch they come with the ranch.
const FREE = new Set(['canMove', 'build']);
// Shop items bought once (or level by level): they count for Perfection. Animals and troughs repeat.
const LASTING = new Set(['area', 'size', 'upgrade', 'command']);

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
    this.functionGate = new Map();
    for (const item of this.shop) for (const f of item.grants || []) this.functionGate.set(f, item.id);
    const layout = (this.cfg.map && this.cfg.map.layout) || [];
    const cell = this.areaSize + 1;
    this.world = { width: 1 + cell * ((layout[0] || []).length || 1), height: 1 + cell * (layout.length || 1) };
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

  get areaSize() {
    return (this.cfg.map && this.cfg.map.area) || 7;
  }

  areaIds() {
    return ((this.cfg.map && this.cfg.map.layout) || []).flat();
  }

  // Map square of an area's (0, 0): areas are laid out in rows (the first row on top), one path apart.
  origin(id) {
    const layout = this.cfg.map.layout;
    const row = layout.findIndex((r) => r.includes(id));
    const cell = this.areaSize + 1;
    return { x: 1 + layout[row].indexOf(id) * cell, y: 1 + (layout.length - 1 - row) * cell };
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

  maxDrones() {
    return 1;
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
      owner.stepDrone(best);
      if ((++steps & 31) === 0 && nowMs() > deadline) {
        let t = target;
        for (const r of runners) if (r.state === 'running') for (const d of r.drones) if (d.state === 'running') t = Math.min(t, d.time);
        return t;
      }
    }
    for (const r of runners) if (r.state === 'running') for (const d of r.drones) if (d.state === 'waiting' && d.time < target) d.time = target;
    return target;
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
    return item.costs ? item.costs[this.level(id)] : item.cost;
  }

  // 'owned' | 'soon' | 'locked' (buy `needs` first) | 'full' (no room for the animal) | 'affordable' | 'expensive'
  shopState(id) {
    const item = this.shopItem(id);
    if (!item) return 'locked';
    if (item.available === false) return 'soon';
    if (this.level(id) >= this.maxLevel(item)) return 'owned';
    if (item.needs && !this.level(item.needs)) return 'locked';
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
    else if (item.kind === 'trough') this.tokens[id] = (this.tokens[id] || 0) + 1;
    if (item.grants) this.api.compiled.clear();
    this.inventory.add('Dram', -cost, 'shop');
    this.events.emit('shop', { id, item, level: this.level(id) });
    this.main.events.emit('ranch', { shop: id });
    return { ok: true };
  }

  // Perfection: the lasting things bought (levels count one by one) of all that can be bought now.
  progress() {
    let value = 0;
    let max = 0;
    for (const item of this.shop) {
      if (item.available === false || !LASTING.has(item.kind)) continue;
      max += this.maxLevel(item);
      value += Math.min(this.level(item.id), this.maxLevel(item));
    }
    return { value, max };
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
    return Math.max(1, Math.round(base * (1 + spread * (2 * r - 1))));
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

  // Feed for ֏: as much as there is money for.
  buyFeed(item, n) {
    const c = (this.cfg.items || {})[item];
    if (!c || !c.buy || !c.feed) return { ok: false };
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

  // Goods were put in a basket (stickers count them).
  unloaded(pen, drone) {
    this.events.emit('unload', { pen: pen.id, x: drone.x, y: drone.y });
    this.main.events.emit('ranch', { unloaded: pen.id });
  }

  villager(i) {
    return (((this.config.village || {}).requests || {}).villagers || [])[i] || { name: '?', face: '🙂' };
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
      const value = Object.entries(items).reduce((a, [item, n]) => a + n * (this.cfg.items[item].sell || 0), 0);
      list.push({ who, line: rng.int(0, Math.max(0, (o.lines || []).length - 1)), items, pay: Math.round(value * (o.pay ?? 1.5)), done: false });
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
      scripts: this.scripts.map((x) => ({ name: x.name, code: x.code })),
      activeScript: this.activeScript,
      pens,
      quests: this.quests.toSave(),
    };
  }
}
