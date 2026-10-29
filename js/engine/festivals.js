// Armenian festivals on their real dates (config/events.json → festivals). Everyone gets the
// festival's bonus (it replaces the luck of the day, see Calendar); with the Festival square repaired,
// objects hidden in the farm can be found: hototel() tells how far the nearest one is, porel() on
// its square takes it, and a dig on a wrong square makes the nearest one run away. Finding `count`
// of them gives the festival's hat.
import { dayNumber } from '../core/util.js';

// Easter Sunday (the Armenian Church keeps the Gregorian date) as a day number.
export function easterDay(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day) / 86400000;
}

// [first, last] day numbers of a festival that starts in `year` ("from"/"to": "MM-DD", or "easter":
// [days before/after Easter]; a festival may go on into the next year, like the New Year).
function span(f, year) {
  if (f.easter) {
    const e = easterDay(year);
    return [e + f.easter[0], e + f.easter[1]];
  }
  const md = (s) => s.replace('-', '');
  const start = dayNumber(`${year}${md(f.from)}`);
  const end = dayNumber(`${year}${md(f.to)}`);
  return [start, end < start ? dayNumber(`${year + 1}${md(f.to)}`) : end];
}

// The festival on day 'YYYYMMDD': its config plus key (id + the year it started), start, end; or null.
// The teacher's events.json → "today" runs one festival on any day.
export function festivalOn(events, day) {
  const list = (events && events.festivals) || [];
  const n = dayNumber(day);
  const year = +day.slice(0, 4);
  const forced = events && events.today && list.find((f) => f.id === events.today);
  if (forced) return { ...forced, key: `${forced.id}${year}`, start: n, end: n };
  for (const f of list) {
    for (const y of [year - 1, year]) {
      const [start, end] = span(f, y);
      if (n >= start && n <= end) return { ...f, key: `${f.id}${y}`, start, end };
    }
  }
  return null;
}

// The next festival after `day`: its config plus inDays; or null.
export function nextFestival(events, day) {
  const n = dayNumber(day);
  const year = +day.slice(0, 4);
  let best = null;
  for (const f of (events && events.festivals) || []) {
    for (const y of [year, year + 1]) {
      const [start] = span(f, y);
      if (start > n && (!best || start < best.start)) best = { ...f, start };
    }
  }
  return best && { ...best, inDays: best.start - n };
}

// The last festival that has already ended before `day` (for its prizes): config plus key; or null.
export function lastFestival(events, day) {
  const n = dayNumber(day);
  const year = +day.slice(0, 4);
  let best = null;
  for (const f of (events && events.festivals) || []) {
    for (const y of [year - 1, year]) {
      const [start, end] = span(f, y);
      if (end < n && (!best || end > best.end)) best = { ...f, key: `${f.id}${y}`, start, end };
    }
  }
  return best;
}

export class Festivals {
  constructor(game, saved = {}) {
    const s = saved || {};
    this.game = game;
    this.found = s.found || {}; // { Easter2026: 23 }: objects found in each festival
    this.spots = s.spots || null; // { key, list: [[x, y], …] }: where the objects hide now
    this.claimed = s.claimed || []; // festivals whose top-3 prize was already looked for
  }

  get cfg() {
    return (this.game.config.events || {}).festival || {};
  }

  // Today's festival (from the calendar), or null.
  get today() {
    const s = this.game.calendar.state;
    return (s && s.festival) || null;
  }

  // The festival whose hidden objects can be found now: it needs the Festival square.
  get active() {
    const f = this.today;
    return f && this.game.village.isRepaired(this.cfg.building) ? f : null;
  }

  count(key) {
    return this.found[key] || 0;
  }

  // The hidden objects of the running festival, inside the farm, `hidden` of them.
  hidden() {
    const f = this.active;
    if (!f) return [];
    const w = this.game.world;
    if (!this.spots || this.spots.key !== f.key) this.spots = { key: f.key, list: [] };
    const list = (this.spots.list = this.spots.list.filter(([x, y]) => x < w.width && y < w.height));
    while (list.length < Math.min(this.cfg.hidden ?? 3, w.width * w.height)) list.push(this.freeSquare());
    return list;
  }

  freeSquare(near = null) {
    const w = this.game.world;
    const rng = this.game.rng;
    for (let i = 0; i < 50; i++) {
      const x = near ? near[0] + rng.int(-2, 2) : rng.int(0, w.width - 1);
      const y = near ? near[1] + rng.int(-2, 2) : rng.int(0, w.height - 1);
      const t = w.tileNoWrap(x, y);
      if (t && t.ground !== 'Pond' && !(this.spots.list || []).some(([a, b]) => a === x && b === y)) return [x, y];
    }
    return [rng.int(0, w.width - 1), rng.int(0, w.height - 1)];
  }

  // hototel(): steps (left/right + up/down) from the drone to the nearest hidden object, or null.
  distance(drone) {
    const list = this.hidden();
    return list.length ? Math.min(...list.map(([x, y]) => Math.abs(x - drone.x) + Math.abs(y - drone.y))) : null;
  }

  // After porel() dug a pit at (x, y): 'found', 'miss' (the nearest object runs away) or null.
  dig(x, y) {
    const f = this.active;
    if (!f) return null;
    const list = this.hidden();
    const i = list.findIndex(([a, b]) => a === x && b === y);
    if (i < 0) {
      const near = list.reduce((best, p, j) => (Math.abs(p[0] - x) + Math.abs(p[1] - y) < Math.abs(list[best][0] - x) + Math.abs(list[best][1] - y) ? j : best), 0);
      list.splice(near, 1);
      list.push(this.freeSquare());
      this.game.events.emit('festivalMiss', { x, y });
      return 'miss';
    }
    list.splice(i, 1);
    list.push(this.freeSquare());
    const count = (this.found[f.key] = this.count(f.key) + 1);
    const hat = count >= (this.cfg.count ?? 60) && this.game.earnHat(f.hat) ? f.hat : null;
    this.game.events.emit('festivalFound', { x, y, count, total: this.cfg.count ?? 60, object: f.object, hat });
    return 'found';
  }

  // Vardavar: watering sometimes splashes a new hidden drop out nearby.
  splash(x, y) {
    const f = this.active;
    if (!f || !f.splash || !this.game.rng.chance(f.splash)) return;
    this.hidden().push(this.freeSquare([x, y]));
  }

  // The festival this player found objects in most recently (its count goes to the leaderboard row).
  latest() {
    const keys = Object.keys(this.found);
    const key = keys[keys.length - 1];
    return key ? { key, found: this.found[key] } : null;
  }

  toSave() {
    return { found: this.found, spots: this.spots, claimed: this.claimed };
  }
}
