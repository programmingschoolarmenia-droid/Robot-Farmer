// Bridgy's quest chain (config/bridgy.json → quests): tracks goals and progress.
import { walk } from '../lang/frontend-js.js';

// Quests inserted after saves kept only the position (index) of the current quest.
const ADDED_LATER = new Set(['buy_fishing', 'fill_pond', 'fish_20', 'golden_fish']);

export class QuestTracker {
  constructor(game, saved = {}) {
    this.game = game;
    this.quests = (game.config.bridgy && game.config.bridgy.quests) || [];
    this.index = startIndex(this.quests, saved);
    this.baseline = saved.baseline || null;
    this.satisfied = saved.satisfied || {};
    this.hintTier = saved.hintTier || 0;
    this.visited = new Set();
    this.offs = [];
    if (this.current() && !this.baseline) this.captureBaseline();
    const ev = game.events;
    this.offs.push(ev.on('runStart', (e) => this.onRunStart(e)));
    this.offs.push(ev.on('move', (e) => this.onMove(e)));
    this.offs.push(ev.on('harvest', (e) => this.onHarvest(e)));
    this.offs.push(ev.on('items', () => this.check()));
    this.offs.push(ev.on('research', () => this.check()));
    this.offs.push(ev.on('plant', (e) => this.onPlant(e)));
    this.offs.push(ev.on('useItem', (e) => this.onUseItem(e)));
  }

  destroy() {
    this.offs.forEach((f) => f());
  }

  current() {
    return this.quests[this.index] || null;
  }

  captureBaseline() {
    const g = this.game;
    this.baseline = { gained: Object.fromEntries(g.stats.totals), harvested: Object.fromEntries(g.stats.harvested), planted: {}, used: {} };
    this.satisfied = {};
    this.hintTier = 0;
  }

  gainedSince(item) {
    return this.game.stats.total(item) - ((this.baseline && this.baseline.gained[item]) || 0);
  }

  harvestedSince(entity) {
    return this.game.stats.harvestCount(entity) - ((this.baseline && this.baseline.harvested[entity]) || 0);
  }

  // Progress of one goal: { done, value, target }
  goalProgress(goal, i) {
    const g = this.game;
    if (this.satisfied[i]) return { done: true, value: goal.amount || 1, target: goal.amount || 1 };
    switch (goal.type) {
      case 'gain': {
        const v = Math.max(0, this.gainedSince(goal.item));
        return { done: v >= goal.amount, value: Math.min(v, goal.amount), target: goal.amount };
      }
      case 'have': {
        const v = g.inventory.get(goal.item);
        return { done: v >= goal.amount, value: Math.min(v, goal.amount), target: goal.amount };
      }
      case 'research': {
        const need = goal.level || 1;
        const v = g.research.level(goal.id);
        return { done: v >= need, value: Math.min(v, need), target: need };
      }
      case 'harvest': {
        const v = Math.max(0, this.harvestedSince(goal.entity));
        return { done: v >= goal.amount, value: Math.min(v, goal.amount), target: goal.amount };
      }
      case 'plant': {
        const v = (this.baseline && this.baseline.planted && this.baseline.planted[goal.entity]) || 0;
        return { done: v >= goal.amount, value: Math.min(v, goal.amount), target: goal.amount };
      }
      case 'use': {
        const v = (this.baseline && this.baseline.used && this.baseline.used[goal.item]) || 0;
        return { done: v >= goal.amount, value: Math.min(v, goal.amount), target: goal.amount };
      }
      case 'pond': {
        const v = g.world.tiles.some((tl) => g.world.isFullPond(tl)) ? 1 : 0;
        return { done: v === 1, value: v, target: 1 };
      }
      case 'fish': {
        const v = Math.max(0, this.harvestedSince(goal.fish));
        return { done: v >= goal.amount, value: Math.min(v, goal.amount), target: goal.amount };
      }
      default:
        return { done: false, value: 0, target: 1 };
    }
  }

  check() {
    const q = this.current();
    if (!q) return;
    let all = true;
    q.goals.forEach((goal, i) => {
      const p = this.goalProgress(goal, i);
      if (p.done) this.satisfied[i] = true;
      else all = false;
    });
    this.game.events.emit('questProgress', { quest: q });
    if (all) this.complete();
  }

  complete() {
    const q = this.current();
    if (!q) return;
    this.index++;
    this.captureBaseline();
    this.game.events.emit('questComplete', { quest: q, next: this.current() });
    // The next quest may already be done (e.g. research bought earlier).
    if (this.current()) setTimeoutSafe(() => this.check());
  }

  markGoal(predicate) {
    const q = this.current();
    if (!q) return;
    let changed = false;
    q.goals.forEach((goal, i) => {
      if (!this.satisfied[i] && predicate(goal)) {
        this.satisfied[i] = true;
        changed = true;
      }
    });
    if (changed) this.check();
  }

  onRunStart({ script }) {
    this.visited = new Set();
    const d = this.game.mainDrone;
    this.visited.add(`${d.x},${d.y}`);
    const info = this.codeInfo(script);
    this.markGoal((goal) => {
      if (goal.type !== 'code') return false;
      if (goal.feature && !info.features.has(goal.feature)) return false;
      if (goal.fn && !info.calls.has(goal.fn)) return false;
      return true;
    });
    this.checkVisitAll();
  }

  // Which syntax features and functions a script (and its imports) uses.
  codeInfo(scriptName) {
    const features = new Set();
    const calls = new Set();
    const api = this.game.api;
    const seen = new Set();
    const visitScript = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const c = api.compiled.get(name);
      if (!c || !c.ast) return;
      walk(c.ast, (node) => {
        switch (node.type) {
          case 'WhileStatement':
          case 'ForStatement':
          case 'DoWhileStatement':
          case 'ForOfStatement':
            features.add('loops');
            break;
          case 'IfStatement':
          case 'ConditionalExpression':
            features.add('if');
            break;
          case 'BinaryExpression':
          case 'LogicalExpression':
          case 'UpdateExpression':
            features.add('operators');
            break;
          case 'VariableDeclaration':
            features.add('variables');
            break;
          case 'FunctionDeclaration':
          case 'FunctionExpression':
          case 'ArrowFunctionExpression':
            features.add('functions');
            break;
          case 'ArrayExpression':
            features.add('lists');
            break;
          case 'ObjectExpression':
            features.add('objects');
            break;
          case 'ImportDeclaration':
            features.add('import');
            visitScript(api.resolveModuleName(node.source.value));
            break;
          case 'CallExpression':
            if (node.callee.type === 'Identifier') calls.add(api.canonicalName(node.callee.name));
            break;
          default:
            break;
        }
      });
    };
    visitScript(scriptName);
    return { features, calls };
  }

  onMove(e) {
    if (e.drone !== 0 && this.game.runner.state === 'idle') return;
    this.visited.add(`${e.x},${e.y}`);
    this.checkVisitAll();
  }

  checkVisitAll() {
    const w = this.game.world;
    if (this.visited.size >= w.width * w.height && w.width * w.height > 1) {
      this.markGoal((goal) => goal.type === 'visitAll');
    }
  }

  onHarvest(e) {
    if (e.giantSize) this.markGoal((goal) => goal.type === 'giant' && e.giantSize >= goal.size);
    if (e.chain) this.markGoal((goal) => goal.type === 'chain' && e.chain >= goal.size);
    this.check();
  }

  onUseItem(e) {
    if (!this.baseline) return;
    if (!this.baseline.used) this.baseline.used = {};
    this.baseline.used[e.item] = (this.baseline.used[e.item] || 0) + 1;
    this.check();
  }

  onPlant(e) {
    if (!this.baseline) return;
    if (!this.baseline.planted) this.baseline.planted = {};
    this.baseline.planted[e.type] = (this.baseline.planted[e.type] || 0) + 1;
    this.check();
  }

  nextHint() {
    const q = this.current();
    if (!q || !q.hints || !q.hints.length) return null;
    const tier = Math.min(this.hintTier, q.hints.length - 1);
    const text = q.hints[tier];
    const last = this.hintTier >= q.hints.length - 1;
    this.hintTier = Math.min(this.hintTier + 1, q.hints.length);
    return { text, tier, last };
  }

  toSave() {
    const q = this.current();
    return { index: this.index, id: q ? q.id : null, baseline: this.baseline, satisfied: this.satisfied, hintTier: this.hintTier };
  }
}

// The current quest of a save: found by its id; older saves counted the list without ADDED_LATER.
function startIndex(quests, saved) {
  const byId = quests.findIndex((q) => q.id === saved.id);
  if (byId >= 0) return byId;
  if (saved.id !== undefined) return Math.min(saved.index ?? 0, quests.length);
  const old = quests.filter((q) => !ADDED_LATER.has(q.id));
  const i = saved.index ?? 0;
  return i < old.length ? quests.indexOf(old[i]) : quests.length;
}

function setTimeoutSafe(fn) {
  if (typeof setTimeout === 'function') setTimeout(fn, 0);
  else fn();
}
