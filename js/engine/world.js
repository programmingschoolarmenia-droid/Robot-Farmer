// The farm grid: ground, plants, water and all crop rules.
// Plants grow lazily: each tile remembers when it was last updated (`lastSync`) and
// `sync(tile, t)` advances it to game time t (exactly, including water evaporation).
import { clamp } from '../core/util.js';
import { Maze } from './maze.js';

export const GROUNDS = ['Grassland', 'Soil', 'Pond']; // saved as their index
export const DIRECTIONS = {
  North: [0, 1],
  East: [1, 0],
  South: [0, -1],
  West: [-1, 0],
};

let giantIds = 1;

export class World {
  constructor(game, width, height, t = 0) {
    this.game = game;
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.maze = null;
    this.juiceCombo = { last: 0, n: 0 }; // pomegranates: the seeds of the last even one harvested, and the combo so far
    const step = this.entityConfig('YellowMelon').spreadSeconds;
    this.nextSpread = step ? (Math.floor(t / step) + 1) * step : Infinity; // game time of the yellow melons' next vines
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.tiles.push(this.newTile(x, y, t));
    }
  }

  get settings() {
    return this.game.config.settings;
  }

  get rng() {
    return this.game.rng;
  }

  get size() {
    return Math.max(this.width, this.height);
  }

  newTile(x, y, t) {
    const tile = { x, y, ground: 'Grassland', entity: null, water: 0, lastSync: t };
    this.spawnGrass(tile, t);
    return tile;
  }

  wrapX(x) {
    return ((x % this.width) + this.width) % this.width;
  }

  wrapY(y) {
    return ((y % this.height) + this.height) % this.height;
  }

  tile(x, y) {
    return this.tiles[this.wrapY(y) * this.width + this.wrapX(x)];
  }

  // Neighbour without wrapping (null outside the farm).
  neighbor(tile, dx, dy) {
    return this.tileNoWrap(tile.x + dx, tile.y + dy);
  }

  tileNoWrap(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.tiles[y * this.width + x];
  }

  resize(width, height, t) {
    if (this.maze && (this.maze.x0 + this.maze.size > width || this.maze.y0 + this.maze.size > height)) this.removeMaze(t);
    const old = this.tiles;
    const ow = this.width;
    const oh = this.height;
    this.width = width;
    this.height = height;
    this.tiles = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < ow && y < oh) {
          const tile = old[y * ow + x];
          this.sync(tile, t);
          this.tiles.push(tile);
        } else this.tiles.push(this.newTile(x, y, t));
      }
    }
    // Giant pumpkins that no longer fit are removed.
    for (const tile of old) {
      if (tile.x >= width || tile.y >= height) {
        const g = tile.entity && tile.entity.data.giant;
        if (g) this.breakGiant(g);
      }
    }
  }

  // ------------------------------------------------------------------ entities

  entityConfig(type) {
    return this.settings.entities[type] || {};
  }

  makeEntity(type) {
    const cfg = this.entityConfig(type);
    const [min, max] = cfg.growTime || [1, 1];
    const e = { type, progress: 0, growTime: Math.max(0.01, this.rng.range(min, max)), data: {} };
    if (type === 'Sunflower') {
      const [a, b] = cfg.petals || [7, 15];
      e.data.petals = this.rng.int(a, b);
    }
    if (type === 'Cactus') {
      const [a, b] = cfg.sizes || [0, 9];
      e.data.size = this.rng.int(a, b);
    }
    return e;
  }

  spawnGrass(tile, t) {
    if (tile.ground === 'Grassland') {
      tile.entity = this.makeEntity('Grass');
      tile.lastSync = Math.max(tile.lastSync, t);
    } else tile.entity = null;
  }

  // Removes whatever grows on the tile (grass grows back on grassland).
  clearTile(tile, t) {
    if (this.maze && this.maze.contains(tile.x, tile.y)) {
      this.removeMaze(t);
      return;
    }
    const g = tile.entity && tile.entity.data.giant;
    if (g) this.breakGiant(g);
    tile.entity = null;
    this.spawnGrass(tile, t);
  }

  breakGiant(g) {
    for (let y = g.y; y < g.y + g.size; y++) {
      for (let x = g.x; x < g.x + g.size; x++) {
        const tile = this.tileNoWrap(x, y);
        if (tile && tile.entity && tile.entity.data.giant === g) delete tile.entity.data.giant;
      }
    }
  }

  isRipe(tile) {
    const e = tile.entity;
    return !!e && e.progress >= 1 && e.type !== 'Dead_Pumpkin' && e.type !== 'Hedge' && e.type !== 'Dinosaur' && e.type !== 'Apple';
  }

  // ------------------------------------------------------------------ growth

  sync(tile, t) {
    if (t >= this.nextSpread) this.spread(t); // the yellow melons' vines come first
    const dt = t - tile.lastSync;
    if (!(dt > 0)) return;
    tile.lastSync = t;
    const cal = this.game.calendar; // seasons and weather (constant during this interval); glass keeps them out
    const glass = !!tile.glass;
    const raining = cal.raining && !glass;
    if (raining) tile.water = 1;
    let grown = null; // on wet soil: real seconds of this interval -> the seconds a plant grew in them
    const w0 = tile.water;
    if (w0 > 0 && tile.ground !== 'Pond') {
      const water = this.settings.water || {};
      const k = raining ? 0 : (water.evaporationPerSecond ?? 0.01) * (glass ? 1 : cal.evaporation);
      const boost = cal.frozen && !glass ? 0 : (water.maxGrowthMultiplier ?? 5) - 1;
      tile.water = w0 * Math.exp(-k * dt);
      if (tile.water < 0.0005) tile.water = 0;
      grown = (x) => (k > 0 ? x + (boost * w0 * (1 - Math.exp(-k * x))) / k : x * (1 + boost * w0));
    }
    const e = tile.entity;
    if (!e) return;
    let after = dt; // the seconds of this interval after the plant was grown
    if (e.progress < 1) {
      if (this.machineConfig(e.type)) {
        if (e.data.making) e.progress = Math.min(1, e.progress + dt / e.growTime); // fixed time, nothing speeds it up
        return;
      }
      const speed = (cal.growth(e.type, glass) * this.game.boost('growth')) / e.growTime;
      const need = (1 - e.progress) / speed; // growing seconds still to go
      const got = grown ? grown(dt) : dt;
      if (got < need) {
        e.progress += got * speed;
        return;
      }
      e.progress = 1;
      after = dt - need;
      if (grown && e.type === 'Pumpkin') {
        // the exact moment it was grown (the same however the time is cut into frames)
        let lo = 0;
        let hi = dt;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (grown(mid) < need) lo = mid;
          else hi = mid;
        }
        after = dt - hi;
      }
      this.onRipe(tile, e, t);
    }
    if (e.type === 'Pumpkin') this.sweeten(tile, e, after);
  }

  syncAll(t) {
    for (const tile of this.tiles) this.sync(tile, t);
  }

  onRipe(tile, e) {
    if (e.type === 'SquareMelon') this.tryMergePumpkins(tile);
  }

  // ------------------------------------------------------------------ watermelons

  // A grown watermelon gets sweeter for ripeWindow seconds (0 -> 100), stays good for rotSeconds and
  // then rots. `over`: its seconds since it was grown. (A luck of the day can stop the rotting.)
  sweeten(tile, e, seconds) {
    const cfg = this.entityConfig('Pumpkin');
    e.data.over = (e.data.over || 0) + seconds;
    if (e.data.over < (cfg.ripeWindow ?? 6) + (cfg.rotSeconds ?? 12) || this.game.calendar.pumpkinDeath(1) === 0) return;
    e.type = 'Dead_Pumpkin';
    this.game.events.emit('pumpkinDied', { x: tile.x, y: tile.y });
  }

  // How sweet a watermelon is: 0 while it grows, then 0 -> 100.
  ripeness(e) {
    if (e.progress < 1) return 0;
    return Math.min(100, Math.floor(((e.data.over || 0) / (this.entityConfig('Pumpkin').ripeWindow ?? 6)) * 100));
  }

  // Yellow melons: every spreadSeconds of game time each ripe one sends a vine into the empty soil next
  // to it. The steps happen at exact game times, before anything else at that time, so the farm is the
  // same at any frame rate.
  spread(t) {
    const step = this.entityConfig('YellowMelon').spreadSeconds;
    while (this.nextSpread <= t) {
      const at = this.nextSpread;
      this.nextSpread = at + step; // (first: the syncs below must not come back here)
      const born = new Set();
      for (const tile of this.tiles) {
        if (!tile.entity || tile.entity.type !== 'YellowMelon') continue;
        this.sync(tile, at);
        if (tile.entity.progress < 1) continue;
        for (const [dx, dy] of Object.values(DIRECTIONS)) {
          const nb = this.neighbor(tile, dx, dy);
          if (nb && nb.ground === 'Soil' && !nb.entity && !nb.glass) born.add(nb);
        }
      }
      for (const nb of born) {
        this.sync(nb, at);
        nb.entity = this.makeEntity('YellowMelon');
      }
    }
  }

  // The ripe yellow melons joined to this one side by side: one harvest takes them all.
  patch(start, t) {
    const out = [start];
    const seen = new Set(out);
    for (const tl of out) {
      for (const [dx, dy] of Object.values(DIRECTIONS)) {
        const nb = this.neighbor(tl, dx, dy);
        if (!nb || seen.has(nb)) continue;
        this.sync(nb, t);
        if (!nb.entity || nb.entity.type !== 'YellowMelon' || nb.entity.progress < 1) continue;
        seen.add(nb);
        out.push(nb);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ square melons (giants)

  // Uses each tile's last synced state (no syncing here, so ripening pumpkins don't
  // trigger nested merges; the last pumpkin of a square to ripen performs the merge).
  isLivePumpkin(tile) {
    if (!tile) return false;
    const e = tile.entity;
    return !!e && e.type === 'SquareMelon' && e.progress >= 1;
  }

  // When a pumpkin ripens, merge the biggest square of ripe pumpkins that contains it.
  tryMergePumpkins(tile) {
    const W = this.width;
    const H = this.height;
    // ok grid + dp of largest square with top-right corner at (x, y)
    const dp = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tl = this.tiles[y * W + x];
        const ok = tl === tile ? true : this.isLivePumpkin(tl);
        if (!ok) continue;
        const left = x > 0 ? dp[y * W + x - 1] : 0;
        const down = y > 0 ? dp[(y - 1) * W + x] : 0;
        const diag = x > 0 && y > 0 ? dp[(y - 1) * W + x - 1] : 0;
        dp[y * W + x] = 1 + Math.min(left, down, diag);
      }
    }
    const candidates = [];
    for (let cy = tile.y; cy < H; cy++) {
      for (let cx = tile.x; cx < W; cx++) {
        const s = dp[cy * W + cx];
        const need = Math.max(cx - tile.x, cy - tile.y) + 1;
        if (s >= need && s >= 2) {
          // the largest square at this corner containing the tile
          candidates.push({ x: cx - s + 1, y: cy - s + 1, size: s });
        }
      }
    }
    candidates.sort((a, b) => b.size - a.size);
    for (const c of candidates) {
      for (let size = c.size; size >= 2; size--) {
        // shrink while keeping the square anchored at its top-right corner and containing tile
        const x0 = c.x + (c.size - size);
        const y0 = c.y + (c.size - size);
        if (tile.x < x0 || tile.y < y0 || tile.x >= x0 + size || tile.y >= y0 + size) break;
        if (this.giantsFit(x0, y0, size)) {
          this.makeGiant(x0, y0, size);
          return;
        }
      }
    }
  }

  // Every existing giant touching the square must be fully inside it.
  giantsFit(x0, y0, size) {
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const g = this.tiles[y * this.width + x].entity.data.giant;
        if (g && (g.x < x0 || g.y < y0 || g.x + g.size > x0 + size || g.y + g.size > y0 + size)) return false;
      }
    }
    return true;
  }

  makeGiant(x0, y0, size) {
    const g = { id: giantIds++, x: x0, y: y0, size };
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) this.tiles[y * this.width + x].entity.data.giant = g;
    }
    this.game.events.emit('giantPumpkin', { x: x0, y: y0, size });
    return g;
  }

  pumpkinYield(size) {
    const cfg = this.entityConfig('SquareMelon').giant || {};
    const cubeUntil = cfg.cubeUntil ?? 5;
    const big = cfg.bigMultiplier ?? 6;
    return size <= cubeUntil ? size * size * size : size * size * big;
  }

  // ------------------------------------------------------------------ yields

  yieldMultiplier(type) {
    const cfg = this.entityConfig(type);
    if (!cfg.yieldResearch) return 1;
    const lvl = this.game.research.level(cfg.yieldResearch);
    const base = cfg.yieldBaseLevel ?? 1;
    const factor = cfg.yieldFactor ?? 2;
    return Math.pow(factor, Math.max(0, lvl - base));
  }

  plantCost(type) {
    const cfg = this.entityConfig(type);
    const cost = cfg.plantCost || {};
    if (!cfg.plantCostScales) return { ...cost };
    const m = this.yieldMultiplier(type);
    const out = {};
    for (const [k, v] of Object.entries(cost)) out[k] = v * m;
    return out;
  }

  // ------------------------------------------------------------------ actions (called by the game API)

  // Returns { ok, reason }
  plant(tile, type, t) {
    this.sync(tile, t);
    const cfg = this.settings.entities[type];
    if (!cfg || cfg.plantable === false) return { ok: false, reason: 'notPlantable' };
    if (!this.game.research.hasEntity(type)) return { ok: false, reason: 'entityLocked' };
    if (tile.ground === 'Pond') return { ok: false, reason: 'pond' };
    if (!(cfg.grounds || ['Grassland', 'Soil']).includes(tile.ground)) return { ok: false, reason: 'wrongGround' };
    const cur = tile.entity;
    if (cur && cur.type !== 'Grass' && cur.type !== 'Dead_Pumpkin') return { ok: false, reason: 'occupied' };
    if (cur && cur.type === 'Grass' && type === 'Grass') return { ok: false, reason: 'occupied' };
    const cost = this.plantCost(type);
    if (!this.game.inventory.canAfford(cost)) return { ok: false, reason: 'cost', cost };
    this.game.inventory.pay(cost, 'plant');
    if (cur && cur.data.giant) this.breakGiant(cur.data.giant);
    tile.entity = this.makeEntity(type);
    return { ok: true };
  }

  till(tile, t) {
    if (this.maze && this.maze.contains(tile.x, tile.y)) this.removeMaze(t);
    this.sync(tile, t);
    const g = tile.entity && tile.entity.data.giant;
    if (g) this.breakGiant(g);
    if (tile.ground === 'Pond') tile.water = 0; // a pond is filled in with earth
    tile.ground = tile.ground === 'Grassland' ? 'Soil' : 'Grassland';
    this.freshSoil(tile);
    tile.entity = null;
    this.spawnGrass(tile, t);
    return { ok: true, ground: tile.ground };
  }

  // Ponds (research Fishing): digPond() makes an empty pit, water from the tanks fills it (it does
  // not dry out), and a full pond has fish.
  digPond(tile, t) {
    const e = tile.entity;
    if (tile.ground === 'Pond' || (e && (e.type === 'Dinosaur' || e.type === 'Apple'))) return false;
    if (this.maze && this.maze.contains(tile.x, tile.y)) this.removeMaze(t);
    this.sync(tile, t);
    const g = tile.entity && tile.entity.data.giant;
    if (g) this.breakGiant(g);
    tile.ground = 'Pond';
    this.freshSoil(tile);
    tile.entity = null;
    tile.water = 0;
    return true;
  }

  // Ground that was dug over is not tired and remembers no crop.
  freshSoil(tile) {
    delete tile.s;
    delete tile.lc;
  }

  // The tricky mushroom hides away from where it expects the student to look, and it expects what
  // followed the same last 3 choices the last time. Any habit loses; only random choices win half the time.
  mushroomFound(side) {
    const m = (this.mushroomMemory ||= { last: '', next: {} });
    const expected = m.next[m.last] ?? (this.rng.next() < 0.5 ? 'East' : 'West');
    m.next[m.last] = side;
    m.last = (m.last + side[0]).slice(-3);
    return side !== expected;
  }

  isFullPond(tile) {
    return tile.ground === 'Pond' && tile.water >= 0.999;
  }

  // Harvests the tile. Returns { ok, removed, items, tiles, type } and what the crop's own rule did:
  // giantSize, patch, chain, green, combo, odd, bees, tired.
  harvest(tile, t) {
    this.sync(tile, t);
    const e = tile.entity;
    if (!e) return { ok: false, removed: false };
    if (this.maze && this.maze.contains(tile.x, tile.y)) return this.harvestMaze(tile, t);
    if (e.type === 'Dinosaur' || e.type === 'Apple') return { ok: false, removed: false };
    if (this.machineConfig(e.type)) return this.collect(tile, e);
    const items = {};
    const add = (item, n) => {
      if (n > 0) items[item] = (items[item] || 0) + n * this.game.calendar.yieldOf(item); // × today's luck
    };

    if (e.type === 'Grass' && e.progress < 1) return { ok: false, removed: false }; // (a beginner's first loop runs here: it just waits)
    if (e.type === 'Dead_Pumpkin' || e.progress < 1) {
      this.clearTile(tile, t);
      return { ok: false, removed: true, items, tiles: [tile], type: e.type, unripe: e.type !== 'Dead_Pumpkin' };
    }

    const cfg = this.entityConfig(e.type);
    const mult = this.yieldMultiplier(e.type) * (e.data.charged ? this.game.calendar.lightningMultiplier : 1); // ⚡ storms
    let tiles = [tile];
    let share = 1; // × the plant's yield
    const extra = {};
    if (e.type === 'SquareMelon' && e.data.giant) {
      const g = e.data.giant;
      tiles = this.tiles.filter((tl) => tl.entity && tl.entity.data.giant === g);
      share = this.pumpkinYield(g.size);
      extra.giantSize = g.size;
    } else if (e.type === 'YellowMelon') {
      tiles = this.patch(tile, t);
      share = tiles.length * tiles.length;
      extra.patch = tiles.length;
    } else if (e.type === 'Cactus') {
      tiles = this.grapeRow(tile, t);
      share = tiles.length * tiles.length;
      extra.chain = tiles.length;
    } else if (e.type === 'Pumpkin' && this.ripeness(e) < (cfg.ripeFrom ?? 80)) {
      share = 0; // grown but not sweet yet: wasted
      extra.green = true;
    } else if (e.type === 'Sunflower') {
      Object.assign(extra, this.squeeze(e));
      share = extra.combo || 0;
    } else if (e.type === 'Mulberry' && this.hasBees(tile, t)) {
      share = cfg.beeMultiplier ?? 2;
      extra.bees = true;
    }
    const soil = this.soilShare(tiles, e.type);
    if (soil < 1) extra.tired = true;
    // (tired soil gives a part of the harvest: the odd fraction becomes a whole item by chance)
    const whole = (x) => (soil < 1 ? Math.floor(x) + (this.rng.chance(x % 1) ? 1 : 0) : x);
    for (const [item, n] of Object.entries(cfg.yield || {})) add(item, whole(n * mult * share * soil));
    if (cfg.seeds) add('Seeds', this.rng.int(cfg.seeds[0], cfg.seeds[1])); // eggplants give their seeds back
    if (cfg.seedChance && this.game.research.hasEntity('Carrot') && this.rng.chance(cfg.seedChance)) add('Seeds', 1); // wheat sometimes drops one

    const fruits = e.data.fruits ?? cfg.fruits ?? 1;
    if (fruits > 1) {
      // an apricot tree stays for its next fruit
      e.data.fruits = fruits - 1;
      e.progress = cfg.regrow ?? 0;
      delete e.data.charged;
    } else {
      for (const tl of tiles) {
        tl.entity = null;
        this.spawnGrass(tl, t);
      }
    }
    return { ok: true, removed: true, items, tiles, type: e.type, ...extra };
  }

  // Tired soil (after the Humus card): the same crop twice in a row on a soil square makes it one step
  // weaker, down to tiredMin; another crop lets it rest one step back, and humus makes it strong at
  // once. Returns the share of the harvest the squares give (their mean) and remembers the crop.
  soilShare(tiles, type) {
    const f = this.settings.fertilizer || {};
    if (this.game.research.level(f.research || 'Fertilizer') <= 0) return 1;
    const step = f.tiredStep ?? 0.1;
    let sum = 0;
    for (const tl of tiles) {
      const s = tl.ground === 'Soil' ? (tl.s ?? 1) : 1;
      sum += s;
      if (tl.ground !== 'Soil') continue;
      const next = Math.round((tl.lc === type ? Math.max(f.tiredMin ?? 0.5, s - step) : Math.min(1, s + step)) * 100) / 100;
      if (next < 1) tl.s = next;
      else delete tl.s;
      tl.lc = type;
    }
    return sum / tiles.length;
  }

  // ------------------------------------------------------------------ pomegranates, mulberries, grapes

  // Pomegranates are squeezed for juice. An even one with more seeds than the last even one makes the
  // combo one longer and pays it; any other even one starts again at 1. An odd one pays nothing and
  // spills one juice from the storage (the combo stays).
  squeeze(e) {
    const seeds = e.data.petals;
    if (seeds % 2) {
      if (this.game.inventory.get('Power') >= 1) this.game.inventory.add('Power', -1, 'spill');
      return { odd: true };
    }
    const c = this.juiceCombo;
    c.n = c.n > 0 && seeds > c.last ? c.n + 1 : 1;
    c.last = seeds;
    return { combo: c.n };
  }

  // Bees: a ripe rosehip right next to the mulberry.
  hasBees(tile, t) {
    return Object.values(DIRECTIONS).some(([dx, dy]) => {
      const nb = this.neighbor(tile, dx, dy);
      if (nb) this.sync(nb, t);
      return !!nb && !!nb.entity && nb.entity.type === 'Bush' && nb.entity.progress >= 1;
    });
  }

  // Grapes: the run of ripe grapes side by side in this row. When none is smaller than the one on its
  // left, one harvest takes the whole run; else only this grape.
  grapeRow(tile, t) {
    const ripe = (tl) => {
      if (tl) this.sync(tl, t);
      return !!tl && !!tl.entity && tl.entity.type === 'Cactus' && tl.entity.progress >= 1;
    };
    const row = [tile];
    for (let nb = this.neighbor(tile, -1, 0); ripe(nb); nb = this.neighbor(nb, -1, 0)) row.unshift(nb);
    for (let nb = this.neighbor(tile, 1, 0); ripe(nb); nb = this.neighbor(nb, 1, 0)) row.push(nb);
    return row.every((tl, i) => !i || row[i - 1].entity.data.size <= tl.entity.data.size) ? row : [tile];
  }

  // Swaps the plants of two tiles (grape sorting).
  swap(a, b, t) {
    if (this.maze && (this.maze.contains(a.x, a.y) || this.maze.contains(b.x, b.y))) return false;
    if ((a.entity && (a.entity.type === 'Dinosaur' || a.entity.type === 'Apple')) || (b.entity && (b.entity.type === 'Dinosaur' || b.entity.type === 'Apple'))) return false;
    this.sync(a, t);
    this.sync(b, t);
    if ((a.entity && a.entity.data.giant) || (b.entity && b.entity.data.giant)) return false;
    const ea = a.entity;
    a.entity = b.entity;
    b.entity = ea;
    if (!a.entity) this.spawnGrass(a, t);
    if (!b.entity) this.spawnGrass(b, t);
    return true;
  }

  // ------------------------------------------------------------------ mazes

  mazeMultiplier() {
    const cfg = this.settings.maze || {};
    const lvl = this.game.research.level(cfg.research || 'Mazes');
    return Math.pow(2, Math.max(0, lvl - 1));
  }

  // Creates a maze around a grown bush (planted: around the drone, on anything). Returns { ok, reason }.
  createMaze(tile, amount, t, planted = false) {
    this.sync(tile, t);
    const e = tile.entity;
    if (!planted && (!e || e.type !== 'Bush' || e.progress < 1)) return { ok: false, reason: 'mazeNeedsBush' };
    const side = Math.min(this.width, this.height, Math.floor(amount / this.mazeMultiplier()));
    if (side < 2) return { ok: false, reason: 'mazeTooSmall', need: 2 * this.mazeMultiplier() };
    if (this.maze) this.removeMaze(t);
    const x0 = clamp(tile.x - Math.floor(side / 2), 0, this.width - side);
    const y0 = clamp(tile.y - Math.floor(side / 2), 0, this.height - side);
    const maze = Maze.generate(x0, y0, side, this.rng);
    maze.amount = amount;
    this.maze = maze;
    this.paintMaze(t);
    this.game.events.emit('mazeCreated', { x0, y0, size: side });
    return { ok: true, maze };
  }

  paintMaze(t) {
    const m = this.maze;
    for (let y = m.y0; y < m.y0 + m.size; y++) {
      for (let x = m.x0; x < m.x0 + m.size; x++) {
        const tl = this.tiles[y * this.width + x];
        this.sync(tl, t);
        const g = tl.entity && tl.entity.data.giant;
        if (g) this.breakGiant(g);
        const treasure = m.treasure.x === x && m.treasure.y === y;
        tl.entity = { type: treasure ? 'Treasure' : 'Hedge', progress: 1, growTime: 1, data: {} };
      }
    }
  }

  removeMaze(t) {
    const m = this.maze;
    if (!m) return [];
    const tiles = [];
    for (let y = m.y0; y < m.y0 + m.size; y++) {
      for (let x = m.x0; x < m.x0 + m.size; x++) {
        const tl = this.tileNoWrap(x, y);
        if (!tl) continue;
        tl.entity = null;
        this.spawnGrass(tl, t);
        tiles.push(tl);
      }
    }
    this.maze = null;
    return tiles;
  }

  mazeGold() {
    const m = this.maze;
    return m.size * m.size * this.mazeMultiplier() * this.game.calendar.yieldOf('Gold'); // × today's luck
  }

  harvestMaze(tile, t) {
    const m = this.maze;
    const onTreasure = m.treasure.x === tile.x && m.treasure.y === tile.y;
    const gold = this.mazeGold();
    const tiles = this.removeMaze(t);
    if (!onTreasure) return { ok: false, removed: true, items: {}, tiles, type: 'Hedge' };
    return { ok: true, removed: true, items: { Gold: gold }, tiles: [tile], type: 'Treasure', maze: true };
  }

  // Weird substance on the treasure moves it (and pays gold). Returns gold or 0.
  relocateTreasure(tile, amount) {
    const m = this.maze;
    const cfg = this.settings.maze || {};
    if (!m || m.treasure.x !== tile.x || m.treasure.y !== tile.y) return 0;
    if (amount < m.amount || m.uses >= (cfg.maxReuses ?? 300)) return 0;
    const gold = this.mazeGold();
    const old = { ...m.treasure };
    m.relocate(this.rng);
    this.tileNoWrap(old.x, old.y).entity = { type: 'Hedge', progress: 1, growTime: 1, data: {} };
    this.tileNoWrap(m.treasure.x, m.treasure.y).entity = { type: 'Treasure', progress: 1, growTime: 1, data: {} };
    return gold;
  }

  // ------------------------------------------------------------------ kitchen machines (village.json → machines)

  machineConfig(type) {
    const v = this.game.config.village;
    return (v && v.machines && v.machines[type]) || null;
  }

  // Builds a machine on an empty or grassy square. Returns { ok, reason, cost }
  build(tile, type, t) {
    this.sync(tile, t);
    const cfg = this.machineConfig(type);
    if (!cfg || !this.game.research.hasMachine(type)) return { ok: false, reason: 'locked' };
    const e = tile.entity;
    if (tile.ground === 'Pond' || (this.maze && this.maze.contains(tile.x, tile.y)) || (e && e.type !== 'Grass')) return { ok: false, reason: 'occupied' };
    if (!this.game.inventory.pay(cfg.cost || {}, 'build')) return { ok: false, reason: 'cost', cost: cfg.cost };
    tile.entity = { type, progress: 0, growTime: 1, data: {} };
    return { ok: true };
  }

  // Starts a recipe (its ingredients come from the storage). Returns { ok, reason, machine, cost }
  make(tile, item, t) {
    this.sync(tile, t);
    const e = tile.entity;
    const cfg = e && this.machineConfig(e.type);
    if (!cfg) return { ok: false, reason: 'noMachine' };
    if (e.data.making) return { ok: false, reason: e.progress >= 1 ? 'ready' : 'busy', machine: e.type };
    const recipe = cfg.recipes && cfg.recipes[item];
    if (!recipe) return { ok: false, reason: 'wrongMachine', machine: e.type };
    if (!this.game.inventory.pay(recipe.in, 'make')) return { ok: false, reason: 'cost', machine: e.type, cost: recipe.in };
    e.data.making = item;
    e.progress = 0;
    e.growTime = recipe.seconds;
    return { ok: true, machine: e.type };
  }

  // havaqel() on a machine takes what is ready (× today's luck); an unfinished one is left alone.
  collect(tile, e) {
    if (!e.data.making || e.progress < 1) return { ok: false, removed: false };
    const item = e.data.making;
    e.data.making = null;
    e.progress = 0;
    return { ok: true, removed: true, items: { [item]: this.game.calendar.yieldOf(item) }, tiles: [tile], type: e.type };
  }

  // Greenhouse glass (village → Greenhouse): seasons and weather don't reach the square. Returns { ok, reason, cost }
  glaze(tile, t) {
    if (tile.glass) return { ok: false, reason: 'already' };
    const cost = ((this.game.config.village || {}).greenhouse || {}).cost || {};
    this.sync(tile, t);
    if (!this.game.inventory.pay(cost, 'glass')) return { ok: false, reason: 'cost', cost };
    tile.glass = true;
    return { ok: true };
  }

  // ------------------------------------------------------------------ water / fertilizer

  addWater(tile, amount, t) {
    this.sync(tile, t);
    tile.water = clamp(tile.water + amount, 0, 1);
  }

  // Humus: a growing plant gains secondsSaved, and tired soil is strong again. Returns whether it did anything.
  fertilize(tile, t) {
    this.sync(tile, t);
    const e = tile.entity;
    const tired = (tile.s ?? 1) < 1;
    delete tile.s;
    if (!e || e.progress >= 1 || this.machineConfig(e.type)) return tired;
    e.progress = Math.min(1, e.progress + ((this.settings.fertilizer || {}).secondsSaved ?? 2) / e.growTime);
    if (e.progress >= 1) this.onRipe(tile, e, t);
    return true;
  }

  // ------------------------------------------------------------------ saving

  toSave() {
    const tiles = this.tiles.map((tl) => {
      const e = tl.entity;
      const row = { g: GROUNDS.indexOf(tl.ground) };
      if (tl.water > 0.001) row.w = Math.round(tl.water * 1000) / 1000;
      if (tl.glass) row.gl = 1;
      if (tl.s < 1) row.s = tl.s;
      if (tl.lc) row.lc = tl.lc;
      if (e) {
        row.e = e.type;
        row.p = Math.round(e.progress * 10000) / 10000;
        row.gt = Math.round(e.growTime * 1000) / 1000;
        const d = {};
        for (const [k, v] of Object.entries(e.data)) {
          if (k === 'giant') continue;
          d[k] = v;
        }
        if (Object.keys(d).length) row.d = d;
      }
      return row;
    });
    const giants = [];
    const seen = new Set();
    for (const tl of this.tiles) {
      const g = tl.entity && tl.entity.data.giant;
      if (g && !seen.has(g)) {
        seen.add(g);
        giants.push({ x: g.x, y: g.y, size: g.size });
      }
    }
    return { w: this.width, h: this.height, tiles, giants, maze: this.maze ? this.maze.toSave() : null, combo: this.juiceCombo };
  }

  static fromSave(game, data, t) {
    const world = new World(game, data.w, data.h, t);
    if (Array.isArray(data.tiles) && data.tiles.length === data.w * data.h) {
      data.tiles.forEach((row, i) => {
        const tile = world.tiles[i];
        tile.ground = GROUNDS[row.g] || 'Grassland';
        tile.water = row.w || 0;
        tile.glass = !!row.gl;
        tile.lastSync = t;
        if (row.s < 1) tile.s = row.s;
        if (row.lc) tile.lc = row.lc;
        if (row.e) {
          // (saves from before: plants were infected by humus and had favourite neighbours)
          const { infected, companion, ...d } = row.d || {};
          tile.entity = { type: row.e, progress: row.p ?? 0, growTime: row.gt ?? 1, data: d };
        } else tile.entity = null;
      });
    }
    if (data.combo) world.juiceCombo = { last: data.combo.last || 0, n: data.combo.n || 0 };
    for (const g of data.giants || []) {
      const tiles = [];
      for (let y = g.y; y < g.y + g.size; y++) for (let x = g.x; x < g.x + g.size; x++) tiles.push(world.tileNoWrap(x, y));
      // (giants of saves from before were watermelons: they are square melons now)
      if (!tiles.every((tl) => tl && tl.entity && (tl.entity.type === 'SquareMelon' || tl.entity.type === 'Pumpkin'))) continue;
      for (const tl of tiles) tl.entity.type = 'SquareMelon';
      world.makeGiantSilently(g.x, g.y, g.size);
    }
    if (data.maze && data.maze.size) {
      const m = Maze.fromSave(data.maze);
      if (m.x0 + m.size <= world.width && m.y0 + m.size <= world.height && m.open.length === m.size * m.size) world.maze = m;
    }
    return world;
  }

  makeGiantSilently(x0, y0, size) {
    const g = { id: giantIds++, x: x0, y: y0, size };
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) this.tiles[y * this.width + x].entity.data.giant = g;
    }
  }
}
