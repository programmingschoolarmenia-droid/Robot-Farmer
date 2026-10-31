// Items the player owns (Hay, Wood, Carrot, …).
export class Inventory {
  constructor(game, saved = {}) {
    this.game = game;
    this.items = new Map();
    for (const [k, v] of Object.entries(saved || {})) {
      if (Number.isFinite(v) && v > 0) this.items.set(k, v);
    }
  }

  get(item) {
    return this.items.get(item) || 0;
  }

  add(item, amount, source = null) {
    if (!amount) return;
    const v = this.get(item) + amount;
    this.items.set(item, Math.max(0, v));
    if (amount > 0 && source !== 'transfer') this.game.stats.recordGain(item, amount); // (a move between storages is no harvest)
    this.game.events.emit('items', { item, amount, total: this.get(item), source });
  }

  canAfford(cost) {
    for (const [item, n] of Object.entries(cost || {})) {
      if (this.get(item) < n) return false;
    }
    return true;
  }

  // Returns the list of missing items: [{ item, need, have }]
  missing(cost) {
    const out = [];
    for (const [item, n] of Object.entries(cost || {})) {
      const have = this.get(item);
      if (have < n) out.push({ item, need: n, have });
    }
    return out;
  }

  pay(cost, source = null) {
    if (!this.canAfford(cost)) return false;
    for (const [item, n] of Object.entries(cost || {})) {
      if (n) this.add(item, -n, source);
    }
    return true;
  }

  toSave() {
    return Object.fromEntries(this.items);
  }
}
