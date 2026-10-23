// Totals and "items per minute" statistics.
export class Stats {
  constructor(game, saved = {}) {
    this.game = game;
    this.totals = new Map(Object.entries((saved && saved.totals) || {}));
    this.harvested = new Map(Object.entries((saved && saved.harvested) || {}));
    this.runs = (saved && saved.runs) || 0;
    this.recent = []; // [{ t, item, n }] within the last minute of game time
  }

  recordGain(item, n) {
    this.totals.set(item, (this.totals.get(item) || 0) + n);
    this.recent.push({ t: this.game.time, item, n });
    if (this.recent.length > 5000) this.prune();
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
    };
  }
}
