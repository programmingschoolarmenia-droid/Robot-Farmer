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

  // Multiplier on grow time (trees next to trees grow slower).
  growthSlowdown(tile, e) {
    const cfg = this.entityConfig(e.type);
    if (!cfg.neighborSlowdown) return 1;
    let n = 0;
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const nb = this.neighbor(tile, dx, dy);
      if (nb && nb.entity && nb.entity.type === e.type) n++;
    }
    return Math.pow(cfg.neighborSlowdown, n);
  }

  sync(tile, t) {
    const dt = t - tile.lastSync;
    if (!(dt > 0)) return;
    tile.lastSync = t;
    const cal = this.game.calendar; // seasons and weather (constant during this interval)
    if (cal.raining) tile.water = 1;
    let effective = dt;
    const w0 = tile.water;
    if (w0 > 0 && tile.ground !== 'Pond') {
      const water = this.settings.water || {};
      const k = cal.raining ? 0 : (water.evaporationPerSecond ?? 0.01) * cal.evaporation;
      const boost = cal.frozen ? 0 : (water.maxGrowthMultiplier ?? 5) - 1;
      const decay = Math.exp(-k * dt);
      tile.water = w0 * decay;
      if (tile.water < 0.0005) tile.water = 0;
      effective = k > 0 ? dt + (boost * w0 * (1 - decay)) / k : dt * (1 + boost * w0);
    }
    const e = tile.entity;
    if (e && e.progress < 1) {
      const gt = e.growTime * this.growthSlowdown(tile, e);
      e.progress = Math.min(1, e.progress + (effective * cal.growth(e.type)) / gt);
      if (e.progress >= 1) this.onRipe(tile, e, t);
    }
  }

  syncAll(t) {
    for (const tile of this.tiles) this.sync(tile, t);
  }

  onRipe(tile, e, t) {
    if (e.type === 'Pumpkin') {
      const cfg = this.entityConfig('Pumpkin');
      if (this.rng.chance(this.game.calendar.pumpkinDeath(cfg.deathChance ?? 0.2))) {
        e.type = 'Dead_Pumpkin';
        this.game.events.emit('pumpkinDied', { x: tile.x, y: tile.y });
        return;
      }
      this.tryMergePumpkins(tile);
    }
  }

  // ------------------------------------------------------------------ pumpkins

  // Uses each tile's last synced state (no syncing here, so ripening pumpkins don't
  // trigger nested merges; the last pumpkin of a square to ripen performs the merge).
  isLivePumpkin(tile) {
    if (!tile) return false;
    const e = tile.entity;
    return !!e && e.type === 'Pumpkin' && e.progress >= 1;
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
    const cfg = this.entityConfig('Pumpkin').giant || {};
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
    tile.entity = null;
    tile.water = 0;
    return true;
  }

  isFullPond(tile) {
    return tile.ground === 'Pond' && tile.water >= 0.999;
  }

  // Harvests the tile. Returns { ok, removed, items, tiles, kind }
  harvest(tile, t) {
    this.sync(tile, t);
    const e = tile.entity;
    if (!e) return { ok: false, removed: false };
    if (this.maze && this.maze.contains(tile.x, tile.y)) return this.harvestMaze(tile, t);
    if (e.type === 'Dinosaur' || e.type === 'Apple') return { ok: false, removed: false };
    const items = {};
    const add = (item, n) => {
      if (n > 0) items[item] = (items[item] || 0) + n * this.game.calendar.yieldOf(item); // × today's luck
    };
    let tiles = [tile];

    if (e.type === 'Dead_Pumpkin' || e.progress < 1) {
      this.clearTile(tile, t);
      return { ok: false, removed: true, items, tiles, type: e.type, unripe: e.type !== 'Dead_Pumpkin' };
    }

    const cfg = this.entityConfig(e.type);
    const mult = this.yieldMultiplier(e.type) * (e.data.charged ? this.game.calendar.lightningMultiplier : 1); // ⚡ storms
    let extra = {};

    if (e.type === 'Pumpkin') {
      const g = e.data.giant;
      if (g) {
        tiles = [];
        let infected = 0;
        for (let y = g.y; y < g.y + g.size; y++) {
          for (let x = g.x; x < g.x + g.size; x++) {
            const tl = this.tiles[y * this.width + x];
            if (tl.entity && tl.entity.data.infected) infected++;
            tiles.push(tl);
          }
        }
        const amount = this.pumpkinYield(g.size) * mult;
        add('Pumpkin', amount);
        if (infected) add('Weird_Substance', Math.ceil(amount * this.infectedShare() * (infected / (g.size * g.size))));
        for (const tl of tiles) {
          tl.entity = null;
          this.spawnGrass(tl, t);
        }
        return { ok: true, removed: true, items, tiles, type: 'Pumpkin', giantSize: g.size };
      }
    }

    if (e.type === 'Cactus') {
      const chain = this.cactusChain(tile, t);
      const n = chain.length;
      add('Cactus', n * n * mult);
      let infected = 0;
      for (const tl of chain) {
        if (tl.entity.data.infected) infected++;
        tl.entity = null;
        this.spawnGrass(tl, t);
      }
      if (infected) add('Weird_Substance', Math.ceil((n * n * mult * this.infectedShare() * infected) / n));
      return { ok: true, removed: true, items, tiles: chain, type: 'Cactus', chain: n };
    }

    if (e.type === 'Sunflower') {
      const bonus = this.sunflowerBonus(tile, t);
      extra = { sunflowerBonus: bonus > 1 };
      add('Power', (cfg.yield && cfg.yield.Power ? cfg.yield.Power : 1) * bonus * mult);
    } else {
      for (const [item, n] of Object.entries(cfg.yield || {})) add(item, n * mult * this.polycultureBonus(tile, e));
    }

    if (e.data.infected) {
      const total = Object.values(items).reduce((a, b) => a + b, 0);
      add('Weird_Substance', Math.ceil(total * this.infectedShare()));
    }
    tile.entity = null;
    this.spawnGrass(tile, t);
    return { ok: true, removed: true, items, tiles, type: e.type, ...extra };
  }

  infectedShare() {
    const f = this.settings.fertilizer || {};
    return f.infectedYieldToWeird ?? 0.5;
  }

  // ------------------------------------------------------------------ sunflowers

  sunflowerBonus(tile, t) {
    const cfg = this.entityConfig('Sunflower');
    let count = 0;
    let maxPetals = -1;
    for (const tl of this.tiles) {
      this.sync(tl, t);
      if (tl.entity && tl.entity.type === 'Sunflower') {
        count++;
        if (tl.entity.data.petals > maxPetals) maxPetals = tl.entity.data.petals;
      }
    }
    if (count >= (cfg.minForBonus ?? 10) && tile.entity.data.petals >= maxPetals) return cfg.bonusMultiplier ?? 8;
    return 1;
  }

  // ------------------------------------------------------------------ cactus

  // A cactus is sorted when N/E neighbours are >= it and S/W neighbours are <= it
  // (neighbours outside the farm don't matter; neighbours that are not grown cacti break it).
  isSortedCactus(tile, t) {
    const e = tile.entity;
    if (!e || e.type !== 'Cactus' || e.progress < 1) return false;
    const s = e.data.size;
    const check = (dx, dy, cmp) => {
      const nb = this.neighbor(tile, dx, dy);
      if (!nb) return true;
      this.sync(nb, t);
      const ne = nb.entity;
      if (!ne || ne.type !== 'Cactus' || ne.progress < 1) return false;
      return cmp(ne.data.size, s);
    };
    return (
      check(0, 1, (n, c) => n >= c) &&
      check(1, 0, (n, c) => n >= c) &&
      check(0, -1, (n, c) => n <= c) &&
      check(-1, 0, (n, c) => n <= c)
    );
  }

  cactusChain(start, t) {
    if (!this.isSortedCactus(start, t)) return [start];
    const out = [];
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const tl = queue.shift();
      out.push(tl);
      for (const [dx, dy] of Object.values(DIRECTIONS)) {
        const nb = this.neighbor(tl, dx, dy);
        if (nb && !seen.has(nb) && this.isSortedCactus(nb, t)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    return out;
  }

  // Swaps the plants of two tiles (cactus sorting).
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

  // Creates a maze around a grown bush. Returns { ok, reason }.
  createMaze(tile, amount, t) {
    this.sync(tile, t);
    const e = tile.entity;
    if (!e || e.type !== 'Bush' || e.progress < 1) return { ok: false, reason: 'mazeNeedsBush' };
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

  // ------------------------------------------------------------------ polyculture

  polycultureLevel() {
    const cfg = this.settings.polyculture || {};
    return this.game.research.level(cfg.research || 'Polyculture');
  }

  // The plant this plant would like next to it: { type, x, y } (assigned once, randomly).
  companionOf(tile) {
    const e = tile.entity;
    const cfg = this.settings.polyculture || {};
    const kinds = cfg.entities || ['Grass', 'Bush', 'Tree', 'Carrot'];
    if (!e || !kinds.includes(e.type) || e.progress === undefined) return null;
    if (e.data.companion) return e.data.companion;
    const others = kinds.filter((k) => k !== e.type);
    const dist = cfg.distance ?? 3;
    const spots = [];
    for (let dy = -dist; dy <= dist; dy++) {
      for (let dx = -dist; dx <= dist; dx++) {
        if ((dx === 0 && dy === 0) || Math.abs(dx) + Math.abs(dy) > dist) continue;
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (x >= 0 && y >= 0 && x < this.width && y < this.height) spots.push([x, y]);
      }
    }
    if (!spots.length) return null;
    const [x, y] = spots[Math.floor(this.rng.next() * spots.length)];
    e.data.companion = { type: others[Math.floor(this.rng.next() * others.length)], x, y };
    return e.data.companion;
  }

  polycultureBonus(tile, e) {
    const lvl = this.polycultureLevel();
    if (lvl <= 0 || !e.data.companion) return 1;
    const c = e.data.companion;
    const other = this.tileNoWrap(c.x, c.y);
    if (!other || !other.entity || other.entity.type !== c.type) return 1;
    const cfg = this.settings.polyculture || {};
    return (cfg.baseMultiplier ?? 5) * Math.pow(2, lvl - 1);
  }

  // ------------------------------------------------------------------ water / fertilizer

  addWater(tile, amount, t) {
    this.sync(tile, t);
    tile.water = clamp(tile.water + amount, 0, 1);
  }

  fertilize(tile, t) {
    this.sync(tile, t);
    const e = tile.entity;
    if (!e || e.progress >= 1) return false;
    const f = this.settings.fertilizer || {};
    const seconds = f.secondsSaved ?? 2;
    const gt = e.growTime * this.growthSlowdown(tile, e);
    e.progress = Math.min(1, e.progress + seconds / gt);
    e.data.infected = true;
    if (e.progress >= 1) this.onRipe(tile, e, t);
    return true;
  }

  // ------------------------------------------------------------------ saving

  toSave() {
    const tiles = this.tiles.map((tl) => {
      const e = tl.entity;
      const row = { g: GROUNDS.indexOf(tl.ground) };
      if (tl.water > 0.001) row.w = Math.round(tl.water * 1000) / 1000;
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
    return { w: this.width, h: this.height, tiles, giants, maze: this.maze ? this.maze.toSave() : null };
  }

  static fromSave(game, data, t) {
    const world = new World(game, data.w, data.h, t);
    if (Array.isArray(data.tiles) && data.tiles.length === data.w * data.h) {
      data.tiles.forEach((row, i) => {
        const tile = world.tiles[i];
        tile.ground = GROUNDS[row.g] || 'Grassland';
        tile.water = row.w || 0;
        tile.lastSync = t;
        if (row.e) {
          tile.entity = {
            type: row.e,
            progress: row.p ?? 0,
            growTime: row.gt ?? 1,
            data: { ...(row.d || {}) },
          };
        } else tile.entity = null;
      });
    }
    for (const g of data.giants || []) {
      let ok = true;
      for (let y = g.y; y < g.y + g.size && ok; y++) {
        for (let x = g.x; x < g.x + g.size; x++) {
          const tl = world.tileNoWrap(x, y);
          if (!tl || !tl.entity || tl.entity.type !== 'Pumpkin') {
            ok = false;
            break;
          }
        }
      }
      if (ok) world.makeGiantSilently(g.x, g.y, g.size);
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
