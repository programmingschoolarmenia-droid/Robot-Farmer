// The research tree (config/research.json): levels, costs, states and what each node unlocks.
export class Research {
  constructor(game, savedLevels = {}) {
    this.game = game;
    this.nodes = game.config.research.nodes;
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.levels = new Map();
    for (const n of this.nodes) this.levels.set(n.id, 0);
    for (const [id, lvl] of Object.entries(savedLevels || {})) {
      if (this.byId.has(id)) this.levels.set(id, Math.min(lvl, this.maxLevel(id)));
    }
    this.unlockAll = !!(game.config.settings.dev && game.config.settings.dev.unlockAll);
    this.rebuildGrants();
  }

  node(id) {
    return this.byId.get(id);
  }

  level(id) {
    if (this.unlockAll && this.byId.has(id)) {
      const n = this.byId.get(id);
      if (n.available !== false) return this.maxLevel(id);
    }
    return this.levels.get(id) || 0;
  }

  maxLevel(id) {
    const n = this.byId.get(id);
    return n ? n.tiers.length : 0;
  }

  isMaxed(id) {
    return this.level(id) >= this.maxLevel(id);
  }

  // A node is visible (can be bought) when all parents have at least one level.
  parentsDone(id) {
    const n = this.byId.get(id);
    if (!n) return false;
    return (n.parents || []).every((p) => this.level(p) > 0);
  }

  nextCost(id) {
    const n = this.byId.get(id);
    const lvl = this.level(id);
    if (!n || lvl >= n.tiers.length) return null;
    return n.tiers[lvl];
  }

  costAt(id, level) {
    const n = this.byId.get(id);
    if (!n || level < 0 || level >= n.tiers.length) return null;
    return n.tiers[level];
  }

  // 'maxed' | 'affordable' | 'expensive' | 'locked' | 'soon'
  state(id) {
    const n = this.byId.get(id);
    if (!n) return 'locked';
    if (this.isMaxed(id)) return 'maxed';
    if (!this.parentsDone(id)) return 'locked';
    if (n.available === false) return 'soon';
    return this.game.inventory.canAfford(this.nextCost(id)) ? 'affordable' : 'expensive';
  }

  canBuy(id) {
    return this.state(id) === 'affordable';
  }

  // Returns { ok, reason }
  buy(id) {
    const st = this.state(id);
    if (st !== 'affordable') return { ok: false, reason: st };
    const cost = this.nextCost(id);
    if (!this.game.inventory.pay(cost, 'research')) return { ok: false, reason: 'expensive' };
    const level = this.level(id) + 1;
    this.levels.set(id, level);
    this.rebuildGrants();
    this.game.events.emit('research', { id, level, node: this.byId.get(id) });
    return { ok: true, level };
  }

  // Sets of everything unlocked: syntax features, functions, entities, hats, panels, machines.
  // Repaired village buildings unlock things too (config/village.json → buildings[].grants).
  rebuildGrants() {
    const g = { syntax: new Set(), functions: new Set(), entities: new Set(), hats: new Set(), panels: new Set(), machines: new Set() };
    this.functionGate = new Map(); // fn name -> node (or building) id that unlocks it
    this.syntaxGate = new Map();
    this.entityGate = new Map();
    this.hatGate = new Map();
    this.machineGate = new Map();
    const village = this.game.village;
    const sources = this.nodes.map((n) => [n, this.level(n.id) > 0]);
    if (village) for (const b of village.buildings) sources.push([b, village.isRepaired(b.id)]);
    for (const [n, unlocked] of sources) {
      const grants = n.grants || {};
      for (const key of ['syntax', 'functions', 'entities', 'hats', 'panels', 'machines']) {
        for (const item of grants[key] || []) {
          if (key === 'functions' && !this.functionGate.has(item)) this.functionGate.set(item, n.id);
          if (key === 'syntax' && !this.syntaxGate.has(item)) this.syntaxGate.set(item, n.id);
          if (key === 'entities' && !this.entityGate.has(item)) this.entityGate.set(item, n.id);
          if (key === 'hats' && !this.hatGate.has(item)) this.hatGate.set(item, n.id);
          if (key === 'machines' && !this.machineGate.has(item)) this.machineGate.set(item, n.id);
          if (unlocked) g[key].add(item);
        }
      }
    }
    this.granted = g;
    // The fisher's hat is not bought: the first golden fish gives it (game.flags.fisherHat).
    this.fisherHat = (this.game.config.settings.fishing || {}).hat;
    if (this.fisherHat) this.hatGate.set(this.fisherHat, null);
    // Event hats are won (config/events.json; game.earnHat → game.flags.hats).
    for (const hat of eventHats(this.game.config.events)) if (!this.hatGate.has(hat)) this.hatGate.set(hat, null);
  }

  hasSyntax(feature) {
    return this.granted.syntax.has(feature) || !this.syntaxGate.has(feature);
  }

  hasFunction(name) {
    return this.granted.functions.has(name) || !this.functionGate.has(name);
  }

  hasEntity(type) {
    return this.granted.entities.has(type) || !this.entityGate.has(type);
  }

  hasHat(name) {
    const flags = this.game.flags;
    return this.granted.hats.has(name) || !this.hatGate.has(name) || (name === this.fisherHat && !!flags.fisherHat) || (flags.hats || []).includes(name);
  }

  hasPanel(name) {
    return this.granted.panels.has(name);
  }

  hasMachine(type) {
    return this.granted.machines.has(type) || !this.machineGate.has(type);
  }

  // Research node that unlocks a function / syntax feature / entity (for help messages).
  nodeForFunction(name) {
    return this.functionGate.get(name) || null;
  }

  nodeForSyntax(feature) {
    return this.syntaxGate.get(feature) || null;
  }

  nodeForEntity(type) {
    return this.entityGate.get(type) || null;
  }

  totalLevels() {
    let sum = 0;
    for (const n of this.nodes) sum += this.level(n.id);
    return sum;
  }

  toSave() {
    return Object.fromEntries([...this.levels].filter(([, v]) => v > 0));
  }
}

// Every hat that config/events.json gives as a prize.
export function eventHats(events = {}) {
  const e = events || {};
  return [
    ...(e.festivals || []).flatMap((f) => [f.hat, f.goldHat]),
    ...((e.challenge || {}).hats || []),
    (e.notes || {}).hat,
    (e.perfection || {}).hat,
  ].filter(Boolean);
}
