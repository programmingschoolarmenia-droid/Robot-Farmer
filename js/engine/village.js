// The village across the river (config/village.json): buildings repaired with items brought little by
// little, what they unlock (grants, like research), and the villagers' daily requests that pay ⭐ stars.
import { Rng } from '../core/rng.js';
import { dayKey } from '../core/util.js';

export class Village {
  constructor(game, saved = {}) {
    const s = saved || {};
    this.game = game;
    this.given = s.given || {}; // { Mill: { Wood: 1200 } }: what was brought to unfinished buildings
    this.repaired = new Set(s.repaired || []);
    this.board = s.board || null; // today's requests: { day, list: [{ who, line, item, amount, done }], bonus }
    this.done = s.done || 0; // requests completed, ever
  }

  get cfg() {
    return this.game.config.village || {};
  }

  get buildings() {
    return this.cfg.buildings || [];
  }

  building(id) {
    return this.buildings.find((b) => b.id === id) || null;
  }

  // (Teachers testing with dev.unlockAll get the whole village.)
  isRepaired(id) {
    const b = this.building(id);
    return !!b && b.available !== false && (this.repaired.has(id) || !!(this.game.settings.dev && this.game.settings.dev.unlockAll));
  }

  allRepaired() {
    return this.buildings.every((b) => b.available === false || this.isRepaired(b.id));
  }

  // 'repaired' | 'open' (items can be brought) | 'locked' (an earlier building first) | 'soon'
  state(id) {
    const b = this.building(id);
    if (!b) return 'locked';
    if (b.available === false) return 'soon';
    if (this.isRepaired(id)) return 'repaired';
    return (b.after || []).every((a) => this.isRepaired(a)) ? 'open' : 'locked';
  }

  // What is still missing: { Wood: 1800 }
  missing(id) {
    const given = this.given[id] || {};
    const out = {};
    for (const [item, n] of Object.entries(this.building(id).cost || {})) if ((given[item] || 0) < n) out[item] = n - (given[item] || 0);
    return out;
  }

  // Brings as much as the storage has of every missing item. Returns { given: { item: n }, repaired }
  give(id) {
    if (this.state(id) !== 'open') return { given: {}, repaired: false };
    const inv = this.game.inventory;
    const given = (this.given[id] = this.given[id] || {});
    const moved = {};
    for (const [item, n] of Object.entries(this.missing(id))) {
      const k = Math.min(n, Math.floor(inv.get(item)));
      if (k <= 0) continue;
      inv.add(item, -k, 'village');
      given[item] = (given[item] || 0) + k;
      moved[item] = k;
    }
    const repaired = !Object.keys(this.missing(id)).length;
    if (repaired) this.repair(id);
    else if (Object.keys(moved).length) this.game.events.emit('village', { id, given: moved });
    return { given: moved, repaired };
  }

  repair(id) {
    this.repaired.add(id);
    delete this.given[id];
    this.game.research.rebuildGrants();
    this.game.api.compiled.clear(); // programs using the new commands compile again
    this.game.events.emit('village', { id, repaired: true, all: this.allRepaired() });
  }

  // ---------------------------------------------------------------- the requests board

  get requestsOpen() {
    return this.isRepaired((this.cfg.requests || {}).building);
  }

  today() {
    const s = this.game.calendar.state;
    return s ? s.day : dayKey(this.game.stats.clock(), (this.game.settings.leaderboard || {}).timeZone);
  }

  // Today's requests, made on the first look of a new day; null before the board opens.
  requests() {
    if (!this.requestsOpen) return null;
    const day = this.today();
    if (!this.board || this.board.day !== day) this.board = this.makeBoard(day);
    return this.board;
  }

  // Different villagers ask for items the student has already gathered (so it is always doable): the
  // more they gathered of it, the more they are asked for (a share of it, never less than the base).
  makeBoard(day) {
    const r = this.cfg.requests;
    const stats = this.game.stats;
    const rng = new Rng(Number(day));
    const items = Object.keys(r.items).filter((item) => stats.total(item) > 0);
    const people = r.villagers.map((_, i) => i);
    const list = [];
    while (list.length < r.perDay && items.length && people.length) {
      const item = items.splice(rng.int(0, items.length - 1), 1)[0];
      const who = people.splice(rng.int(0, people.length - 1), 1)[0];
      const amount = niceAmount(Math.max(r.items[item], stats.total(item) * (r.share ?? 0.02)));
      list.push({ who, line: rng.int(0, r.villagers[who].lines.length - 1), item, amount, done: false });
    }
    return { day, list, bonus: false };
  }

  // Gives a villager what they asked for: ⭐ stars, plus the bonus when all of today's are done.
  deliver(i) {
    const board = this.requests();
    const q = board && board.list[i];
    const cost = q && { [q.item]: q.amount };
    if (!q || q.done || !this.game.inventory.pay(cost, 'request')) return 0;
    const r = this.cfg.requests;
    q.done = true;
    this.done++;
    let stars = r.stars ?? 1;
    if (board.list.every((x) => x.done)) {
      board.bonus = true;
      stars += r.bonus ?? 0;
    }
    if (stars > 0) this.game.inventory.add('Star', stars, 'request');
    this.game.events.emit('request', { index: i, stars, bonus: board.bonus });
    return stars;
  }

  // One recipe of the unlocked machines for this week (Bridgy's TV): { machine, item, in, seconds }
  weeklyRecipe() {
    const list = [];
    for (const [machine, m] of Object.entries(this.cfg.machines || {})) {
      if (!this.game.research.hasMachine(machine)) continue;
      for (const [item, recipe] of Object.entries(m.recipes || {})) list.push({ machine, item, ...recipe });
    }
    if (!list.length) return null;
    const d = this.today();
    return list[Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 604800000) % list.length];
  }

  toSave() {
    return { given: this.given, repaired: [...this.repaired], board: this.board, done: this.done };
  }
}

// Rounds to two digits, so villagers ask for 1 200 rather than 1 234.
function niceAmount(n) {
  const v = Math.max(1, Math.round(n));
  const p = Math.pow(10, Math.max(0, String(v).length - 2));
  return Math.round(v / p) * p;
}
