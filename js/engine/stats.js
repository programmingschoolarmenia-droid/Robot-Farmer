// Totals and "items per minute" statistics, plus the leaderboard numbers: points (everything
// gathered × its weight in settings.json → leaderboard.points), today's and this month's points,
// the day streak and the code words (js/lang/codeWords.js).
import { dayKey, prevDayKey } from '../core/util.js';

const MAX_CODE_SEEN = 10000; // keeps the save small

export class Stats {
  constructor(game, saved = {}) {
    const s = saved || {};
    this.game = game;
    this.totals = new Map(Object.entries(s.totals || {}));
    this.harvested = new Map(Object.entries(s.harvested || {}));
    this.runs = s.runs || 0;
    this.recent = []; // [{ t, item, n }] within the last minute of game time
    this.day = s.day || { key: '', points: 0 }; // key: 'YYYYMMDD'
    this.prevDay = s.prevDay || null;
    this.month = s.month || { key: '', points: 0 }; // key: 'YYYYMM'
    this.prevMonth = s.prevMonth || null;
    this.streak = s.streak || 0; // days in a row with points
    this.codeWords = s.codeWords || 0;
    this.codeSeen = new Set(s.codeSeen ? s.codeSeen.split(',') : []);
    this.clock = () => Date.now(); // real time (tests replace it)
    this.keyAt = -Infinity;
  }

  get board() {
    return this.game.settings.leaderboard || {};
  }

  recordGain(item, n) {
    this.totals.set(item, (this.totals.get(item) || 0) + n);
    this.recent.push({ t: this.game.time, item, n });
    if (this.recent.length > 5000) this.prune();
    const points = n * ((this.board.points || {})[item] || 0);
    if (points > 0) {
      this.roll();
      this.day.points += points;
      this.month.points += points;
    }
  }

  // Starts a new day / month when the date changed (checked at most every 30 s).
  roll() {
    const now = this.clock();
    if (now >= this.keyAt && now - this.keyAt < 30000) return;
    this.keyAt = now;
    const key = dayKey(now, this.board.timeZone);
    if (key !== this.day.key) {
      this.streak = this.day.key === prevDayKey(key) ? this.streak + 1 : 1;
      if (this.day.key) this.prevDay = this.day;
      this.day = { key, points: 0 };
    }
    if (key.slice(0, 6) !== this.month.key) {
      if (this.month.key) this.prevMonth = this.month;
      this.month = { key: key.slice(0, 6), points: 0 };
    }
  }

  // All-time points (recomputed, so changed weights count for the past too).
  points() {
    const weights = this.board.points || {};
    let sum = 0;
    for (const [item, n] of this.totals) sum += n * (weights[item] || 0);
    return Math.floor(sum);
  }

  // [{ item, amount, weight, points }] for the profile, biggest first; items worth nothing are left out.
  breakdown() {
    const weights = this.board.points || {};
    return [...this.totals]
      .filter(([item, n]) => n > 0 && weights[item] > 0)
      .map(([item, n]) => ({ item, amount: n, weight: weights[item], points: Math.floor(n * weights[item]) }))
      .sort((a, b) => b.points - a.points);
  }

  // Adds the words of code fingerprints never seen before ([{ hash, words }]); returns how many.
  addCode(list) {
    let added = 0;
    for (const { hash, words } of list) {
      if (this.codeSeen.has(hash) || this.codeSeen.size >= MAX_CODE_SEEN) continue;
      this.codeSeen.add(hash);
      added += words;
    }
    this.codeWords += added;
    return added;
  }

  recordHarvest(type, count = 1) {
    this.harvested.set(type, (this.harvested.get(type) || 0) + count);
  }

  total(item) {
    return this.totals.get(item) || 0;
  }

  harvestCount(type) {
    return this.harvested.get(type) || 0;
  }

  prune() {
    const cutoff = this.game.time - 60;
    let i = 0;
    while (i < this.recent.length && this.recent[i].t < cutoff) i++;
    if (i) this.recent.splice(0, i);
  }

  // Items gained per minute of game time (over the last minute).
  perMinute(item) {
    this.prune();
    let sum = 0;
    for (const r of this.recent) if (r.item === item) sum += r.n;
    return sum;
  }

  toSave() {
    return {
      totals: Object.fromEntries(this.totals),
      harvested: Object.fromEntries(this.harvested),
      runs: this.runs,
      day: { ...this.day },
      prevDay: this.prevDay && { ...this.prevDay },
      month: { ...this.month },
      prevMonth: this.prevMonth && { ...this.prevMonth },
      streak: this.streak,
      codeWords: this.codeWords,
      codeSeen: [...this.codeSeen].join(','),
    };
  }
}
