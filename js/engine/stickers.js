// Stickers for the profile's album (config/events.json → stickers; `secret` ones show «?» until
// earned) and Perfection %: how much of the game a student has done.
import { codeInfo } from './quests.js';
import { FISH_NAMES } from './api.js';

// { percent, parts: [{ id, value, max, weight }] } from events.json → perfection weights. Only what
// students can get counts («soon» research and buildings don't). (The ranch's animals and
// buildings will be added as more parts.)
export function perfection(game) {
  const w = (game.config.events || {}).perfection || {};
  const nodes = game.research.nodes.filter((n) => n.available !== false);
  const buildings = game.village.buildings.filter((b) => b.available !== false);
  const parts = [
    { id: 'research', value: nodes.reduce((a, n) => a + game.research.level(n.id), 0), max: nodes.reduce((a, n) => a + n.tiers.length, 0), weight: w.research ?? 70 },
    { id: 'village', value: buildings.filter((b) => game.village.isRepaired(b.id)).length, max: buildings.length, weight: w.village ?? 30 },
  ];
  const total = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const done = parts.reduce((a, p) => a + (p.max ? (p.weight * Math.min(p.value, p.max)) / p.max : p.weight), 0);
  return { percent: Math.floor((100 * done) / total + 1e-9), parts };
}

export class Stickers {
  constructor(game, saved = {}) {
    const s = saved || {};
    this.game = game;
    this.earned = new Set(s.earned || []);
    this.seen = { flips: 0, worn: [], eaten: 0, ...(s.seen || {}) }; // counts for the secret ones
    // Each event looks only at the stickers it can change (harvests come many times a second).
    const on = (name, kinds, ctx = () => ({})) => game.events.on(name, (e) => this.check(kinds, ctx(e)));
    on('runStart', ['feature', 'params', 'recursion'], (e) => ({ code: codeInfo(game.api, e.script) }));
    on('harvest', ['giant', 'chain', 'sunflowerBonus', 'total'], (e) => ({ harvest: e }));
    on('dino', ['dino'], (e) => ({ dino: e.end ? e : null }));
    on('fish', ['fishAll', 'fish', 'goldenFish', 'total']);
    on('drones', ['drones']);
    on('runEnd', ['codeWords', 'total']);
    on('village', ['village', 'perfection']);
    on('request', ['requests']);
    on('hatEarned', ['festivalHats']);
    on('noteSolved', ['notes']);
    on('research', ['researchAll', 'perfection']);
    on('challengePrize', ['challengeTop']);
    game.events.on('flip', () => {
      this.seen.flips++;
      this.check(['flips']);
    });
    game.events.on('hat', (e) => {
      if (!this.seen.worn.includes(e.hat)) this.seen.worn.push(e.hat);
      this.check(['hats']);
    });
    game.events.on('boost', (e) => {
      if (!e.until) return; // (a boost that ran out)
      this.seen.eaten++;
      this.check(['eaten']);
    });
    for (const name of ['research', 'village']) game.events.on(name, () => this.checkLegend());
  }

  get list() {
    return (this.game.config.events || {}).stickers || [];
  }

  // Is a sticker's condition (its `when`) true now? ctx: what just happened (code, harvest, dino).
  met(when, ctx) {
    const g = this.game;
    const { stats, village } = g;
    const [kind, v] = Object.entries(when)[0] || [];
    switch (kind) {
      case 'feature':
        return !!ctx.code && ctx.code.features.has(v);
      case 'params':
      case 'recursion':
        return !!ctx.code && ctx.code[kind];
      case 'drones':
        return g.runner.activeDroneCount() >= v;
      case 'codeWords':
        return stats.codeWords >= v;
      case 'giant':
        return !!ctx.harvest && ctx.harvest.giantSize >= v;
      case 'chain':
        return !!ctx.harvest && ctx.harvest.chain >= v;
      case 'sunflowerBonus':
        return !!ctx.harvest && !!ctx.harvest.sunflowerBonus;
      case 'dino':
        return !!ctx.dino && ctx.dino.length >= v;
      case 'fishAll':
        return FISH_NAMES.every((f) => stats.harvestCount(f) > 0);
      case 'fish':
        return stats.harvestCount(v) > 0;
      case 'goldenFish':
        return stats.harvestCount('Golden_Fish') >= v;
      case 'total':
        return Object.entries(v).every(([item, n]) => stats.total(item) >= n);
      case 'researchAll':
        return g.research.nodes.every((n) => n.available === false || g.research.isMaxed(n.id));
      case 'village':
        return village.allRepaired();
      case 'requests':
        return village.done >= v;
      case 'notes':
        return g.notes.solved >= v;
      case 'festivalHats': {
        const hats = ((g.config.events || {}).festivals || []).map((f) => f.hat);
        const have = hats.filter((h) => (g.flags.hats || []).includes(h)).length;
        return v === 'all' ? have === hats.length : have >= v;
      }
      case 'challengeTop':
        return !!g.flags.challengeTop && g.flags.challengeTop <= v;
      case 'perfection':
        return perfection(g).percent >= v;
      case 'flips':
        return this.seen.flips >= v;
      case 'hats':
        return this.seen.worn.length >= v;
      case 'eaten':
        return this.seen.eaten >= v;
      default:
        return false;
    }
  }

  // Emits one 'sticker' event with every sticker earned now (a returning player may get several).
  check(kinds, ctx = {}) {
    const ids = [];
    for (const s of this.list) {
      const when = s.when || {};
      if (this.earned.has(s.id) || !kinds.includes(Object.keys(when)[0]) || !this.met(when, ctx)) continue;
      this.earned.add(s.id);
      ids.push(s.id);
    }
    if (ids.length) this.game.events.emit('sticker', { ids });
  }

  // 100% Perfection: the legend's hat.
  checkLegend() {
    const hat = ((this.game.config.events || {}).perfection || {}).hat;
    if (hat && perfection(this.game).percent >= 100) this.game.earnHat(hat);
  }

  toSave() {
    return { earned: [...this.earned], seen: this.seen };
  }
}
