// The whole game state and rules, without any UI. The UI listens to `game.events`.
import { Events } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { Inventory } from './inventory.js';
import { Research } from './research.js';
import { World, DIRECTIONS } from './world.js';
import { Drone } from './drone.js';
import { Stats } from './stats.js';
import { Calendar } from './calendar.js';
import { Village } from './village.js';
import { Festivals } from './festivals.js';
import { Notes } from './notes.js';
import { Stickers, perfection } from './stickers.js';
import { GameApi, FISH_NAMES } from './api.js';
import { Runner } from './runner.js';
import { Ranch } from './ranch.js';
import { locOf } from '../lang/errors.js';
import { DIR_BITS } from './maze.js';

// 2: Speed has 7 levels. 3: the cards hang in the school's code order (bought levels stay as they
// are, also when a new parent card isn't owned yet, so nothing is converted). 4: our own crop rules
// (new farm sizes, eggplant seeds; see `migrate`).
export const SAVE_VERSION = 4;
// Saves from when Speed had 5 levels: the 7-level one at least as fast (the top speed is the same).
const OLD_SPEED_LEVEL = [0, 2, 3, 5, 6, 7];
// Saves from before version 4: the farm was 1, 3×1, 3, 4, 6, 8, 12, 16, 22 and 32 squares wide. Each
// level moves to the new one at least as big; a 22 or 32 farm keeps its size (flags.farmSize).
const OLD_EXPAND_LEVEL = [0, 2, 2, 3, 5, 6, 8, 9, 9, 9];
const OLD_BIG_FARM = { 8: 22, 9: 32 };

export class Game {
  constructor(config, save = {}) {
    this.config = config;
    this.events = new Events();
    this.rng = new Rng(save.seed ?? ((Math.random() * 4294967296) >>> 0));
    this.time = save.time ?? 0;
    this.playSeconds = save.playSeconds ?? 0;
    this.stats = new Stats(this, save.stats);
    this.calendar = new Calendar(this); // before the world: World.sync reads its rules
    this.village = new Village(this, save.village); // before research: repaired buildings unlock commands
    this.festivals = new Festivals(this, save.festivals);
    this.notes = new Notes(this, save.notes);
    this.stickers = new Stickers(this, save.stickers);
    this.boosts = { ...(save.boosts || {}) }; // eaten dishes: { speed: { item, multiplier, until } }
    this.flags = { ...(save.flags || {}) };
    this.inventory = new Inventory(this, save.inventory ?? (this.settings.game && this.settings.game.startItems) ?? {});
    const extra = this.settings.dev && this.settings.dev.extraItems;
    if (extra && !save.inventory) for (const [k, v] of Object.entries(extra)) this.inventory.items.set(k, v);
    this.research = new Research(this, this.migrate(save));
    const [w, h] = this.worldSizeForLevel(this.research.level(this.sizeResearch));
    if (save.world && save.world.w && save.world.h) {
      this.world = World.fromSave(this, save.world, this.time);
      if (this.world.width !== w || this.world.height !== h) this.world.resize(w, h, this.time);
    } else {
      this.world = new World(this, w, h, this.time);
    }
    this.mainDrone = new Drone(this, 0, save.drone);
    this.mainDrone.x = Math.min(this.mainDrone.x, this.world.width - 1);
    this.mainDrone.y = Math.min(this.mainDrone.y, this.world.height - 1);
    this.api = new GameApi(this);
    this.runner = new Runner(this);
    const starter = (config.bridgy && config.bridgy.starterCode) || 'harvest();\n';
    this.scripts = Array.isArray(save.scripts) && save.scripts.length ? save.scripts.map((s) => ({ ...s })) : [{ name: 'main', code: starter }];
    this.activeScript = this.scripts.some((s) => s.name === save.activeScript) ? save.activeScript : this.scripts[0].name;
    this.speed = (this.settings.game && this.settings.game.defaultSpeed) || 1;
    this.warned = new Set();
    this.production = { Water: 0, Fertilizer: 0, ...(save.production || {}) };
    this.challenge = { week: '', code: '', best: 0, bestCode: '', prev: null, prizeWeek: '', ...(save.challenge || {}) }; // the weekly challenge (js/engine/challenge.js)
    this.dino = null;
    if (save.dino && this.mainDrone.hat === 'Dinosaur_Hat') {
      this.dino = { drone: this.mainDrone, tail: save.dino.tail || [], apple: save.dino.apple || null, eaten: save.dino.eaten || 0, moves: save.dino.moves || 0 };
    } else if (this.mainDrone.hat === 'Dinosaur_Hat') this.mainDrone.hat = 'Straw_Hat';
    this.ranch = new Ranch(this, save.ranch); // the second world (js/engine/ranch.js); it runs only while open
    this.events.on('research', (e) => this.onResearch(e));
    this.calendar.update(this.time);
  }

  get settings() {
    return this.config.settings;
  }

  get sizeResearch() {
    return (this.settings.world && this.settings.world.sizeResearch) || 'Expand';
  }

  worldSizeForLevel(level) {
    const sizes = (this.settings.world && this.settings.world.sizes) || [[1, 1]];
    const s = sizes[Math.min(level, sizes.length - 1)];
    const least = this.flags.farmSize || 0; // (a farm from before the new sizes never shrinks)
    return [Math.max(s[0], least), Math.max(s[1], least)];
  }

  // The research levels of a save in today's form. Older saves are moved up; a new game has no `v`.
  migrate(save) {
    const research = { ...(save.research || {}) };
    if (save.v === 1 && research.Speed) research.Speed = OLD_SPEED_LEVEL[research.Speed];
    if (save.v < 4) {
      const old = research.Expand || 0;
      if (old) research.Expand = OLD_EXPAND_LEVEL[old];
      if (OLD_BIG_FARM[old]) this.flags.farmSize = OLD_BIG_FARM[old];
      if (research.Carrots && !this.inventory.get('Seeds')) this.inventory.items.set('Seeds', 10); // eggplants need seeds now
      if (this.inventory.get('Power') > 0) this.flags.juiceNote = true; // Bridgy says once that juice is drunk with xmel()
    }
    return research;
  }

  onResearch({ id }) {
    if (id === this.sizeResearch) {
      const [w, h] = this.worldSizeForLevel(this.research.level(id));
      if (w !== this.world.width || h !== this.world.height) {
        this.world.resize(w, h, this.time);
        for (const d of [this.mainDrone, ...this.runner.drones]) {
          d.x = Math.min(d.x, w - 1);
          d.y = Math.min(d.y, h - 1);
        }
        this.events.emit('worldResized', { width: w, height: h });
      }
    }
    this.api.compiled.clear();
  }

  // ------------------------------------------------------------------ time

  // Called every animation frame with real seconds elapsed.
  update(realDt) {
    const g = this.settings.game || {};
    this.calendar.update(this.time);
    this.updateBoosts();
    const dt = Math.min(realDt, g.maxFrameSeconds ?? 0.1) * this.speed;
    this.playSeconds += Math.min(realDt, 0.25);
    const runner = this.runner;
    if (runner.state === 'paused') {
      if (runner.stepTarget !== null && runner.stepTarget > this.time) {
        this.advanceTime(Math.min(runner.stepTarget, this.time + dt));
      }
      return;
    }
    const target = this.time + dt;
    const reached = runner.state === 'running' ? runner.update(target, g.frameBudgetMs ?? 12) : target;
    this.advanceTime(Math.max(this.time, reached));
  }

  advanceTime(t) {
    const dt = t - this.time;
    if (dt <= 0) return;
    this.time = t;
    this.produce('Water', this.settings.water, dt);
    this.produce('Fertilizer', this.settings.fertilizer, dt);
    this.calendar.tick(dt, t);
  }

  // Passive production of water tanks / fertilizer after their research.
  produce(item, cfg, dt) {
    if (!cfg || !cfg.research) return;
    const lvl = this.research.level(cfg.research);
    if (lvl <= 0) return;
    const per = (cfg.secondsPerItem ?? 10) / Math.pow(2, lvl - 1);
    this.production[item] = (this.production[item] || 0) + dt / per;
    const whole = Math.floor(this.production[item]);
    if (whole > 0) {
      this.production[item] -= whole;
      this.inventory.add(item, whole, 'production');
    }
  }

  // ------------------------------------------------------------------ actions used by the API

  moveDrone(d, dir, t) {
    const [dx, dy] = DIRECTIONS[dir];
    if (!this.canMove(d, dir)) return { ok: false };
    const fromX = d.x;
    const fromY = d.y;
    if (this.dino && this.dino.drone === d) return this.moveDino(d, dx, dy, t);
    d.x = this.world.wrapX(d.x + dx);
    d.y = this.world.wrapY(d.y + dy);
    this.events.emit('move', { drone: d.id, fromX, fromY, x: d.x, y: d.y, t });
    return { ok: true, fromX, fromY, dx, dy };
  }

  canMove(d, dir) {
    const [dx, dy] = DIRECTIONS[dir];
    const w = this.world;
    if (this.dino && this.dino.drone === d) {
      const nx = d.x + dx;
      const ny = d.y + dy;
      if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) return false;
      const tail = this.dino.tail;
      const growing = this.dino.apple && this.dino.apple.x === nx && this.dino.apple.y === ny;
      const blocking = growing ? tail : tail.slice(0, -1);
      return !blocking.some((p) => p.x === nx && p.y === ny);
    }
    if (w.maze) {
      const m = w.maze;
      const tx = w.wrapX(d.x + dx);
      const ty = w.wrapY(d.y + dy);
      const curIn = m.contains(d.x, d.y);
      const tgtIn = m.contains(tx, ty);
      if (curIn || tgtIn) {
        if (!(curIn && tgtIn)) return false; // hedge walls around the maze
        if (tx !== d.x + dx || ty !== d.y + dy) return false; // no wrapping through the outer wall
        return (m.cellOpen(d.x, d.y) & DIR_BITS[dir]) !== 0;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ dinosaur

  dinoLevel() {
    const cfg = this.settings.dinosaur || {};
    return this.research.level(cfg.research || 'Dinosaurs');
  }

  startDino(drone, t) {
    if (this.dino && this.dino.drone !== drone) return false;
    // A hedge maze would trap the dinosaur: it disappears when the hat goes on.
    if (this.world.maze) this.world.removeMaze(t);
    this.dino = { drone, tail: [], apple: null, eaten: 0, moves: 0 };
    this.spawnApple(t);
    this.events.emit('dino', { start: true });
    return true;
  }

  finishDino(t) {
    const dino = this.dino;
    if (!dino) return;
    const length = dino.eaten + 1;
    const bones = dino.eaten * length * Math.pow(2, Math.max(0, this.dinoLevel() - 1)) * this.calendar.yieldOf('Bone'); // mice × length
    for (const p of dino.tail) {
      const tl = this.world.tileNoWrap(p.x, p.y);
      if (tl && tl.entity && tl.entity.type === 'Dinosaur') {
        tl.entity = null;
        this.world.spawnGrass(tl, t);
      }
    }
    if (dino.apple) {
      const tl = this.world.tileNoWrap(dino.apple.x, dino.apple.y);
      if (tl && tl.entity && tl.entity.type === 'Apple') {
        tl.entity = null;
        this.world.spawnGrass(tl, t);
      }
    }
    this.dino = null;
    if (dino.eaten > 0) this.inventory.add('Bone', bones, { x: dino.drone.x, y: dino.drone.y, drone: dino.drone.id });
    this.events.emit('dino', { end: true, bones: dino.eaten > 0 ? bones : 0, length });
  }

  // The mouse the snake hunts (inside the game it is still the Apple of old saves): a random free square.
  spawnApple(t) {
    const dino = this.dino;
    const w = this.world;
    dino.apple = null;
    const free = w.tiles.filter(
      (tl) => !(tl.x === dino.drone.x && tl.y === dino.drone.y) && !dino.tail.some((p) => p.x === tl.x && p.y === tl.y) && !(w.maze && w.maze.contains(tl.x, tl.y)),
    );
    if (free.length) this.putMouse(free[Math.floor(this.rng.next() * free.length)], t);
  }

  putMouse(tl, t) {
    const old = this.dino.apple && this.world.tileNoWrap(this.dino.apple.x, this.dino.apple.y);
    if (old && old.entity && old.entity.type === 'Apple') {
      old.entity = null;
      this.world.spawnGrass(old, t);
    }
    const g = tl.entity && tl.entity.data.giant;
    if (g) this.world.breakGiant(g);
    tl.entity = { type: 'Apple', progress: 1, growTime: 1, data: {} };
    this.dino.apple = { x: tl.x, y: tl.y };
  }

  // The mouse runs one square: to the free square next to it that is farthest from the snake's head,
  // and only when that is farther than where it sits (in a corner it stays).
  runMouse(t) {
    const { apple, drone, tail } = this.dino;
    const far = (x, y) => Math.abs(x - drone.x) + Math.abs(y - drone.y);
    let best = null;
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const tl = this.world.tileNoWrap(apple.x + dx, apple.y + dy);
      if (!tl || (tl.x === drone.x && tl.y === drone.y) || tail.some((p) => p.x === tl.x && p.y === tl.y)) continue;
      if (far(tl.x, tl.y) > far(apple.x, apple.y) && (!best || far(tl.x, tl.y) > far(best.x, best.y))) best = tl;
    }
    if (best) this.putMouse(best, t);
  }

  moveDino(d, dx, dy, t) {
    const dino = this.dino;
    const w = this.world;
    const fromX = d.x;
    const fromY = d.y;
    const nx = d.x + dx;
    const ny = d.y + dy;
    const eating = dino.apple && dino.apple.x === nx && dino.apple.y === ny;
    dino.tail.unshift({ x: fromX, y: fromY });
    const fromTile = w.tileNoWrap(fromX, fromY);
    fromTile.entity = { type: 'Dinosaur', progress: 1, growTime: 1, data: {} };
    if (eating) {
      dino.eaten++;
      const at = w.tileNoWrap(nx, ny);
      at.entity = null;
      this.events.emit('appleEaten', { x: nx, y: ny, eaten: dino.eaten });
    } else if (dino.tail.length > dino.eaten) {
      const last = dino.tail.pop();
      const tl = w.tileNoWrap(last.x, last.y);
      if (tl && tl.entity && tl.entity.type === 'Dinosaur') {
        tl.entity = null;
        w.spawnGrass(tl, t);
      }
    }
    d.x = nx;
    d.y = ny;
    const target = w.tileNoWrap(nx, ny);
    if (target.entity && (target.entity.type === 'Grass' || target.entity.type === 'Dinosaur')) target.entity = null;
    const cfg = this.settings.dinosaur || {};
    if (eating) this.spawnApple(t);
    else if (dino.apple && ++dino.moves % (cfg.mouseEvery ?? 2) === 0) this.runMouse(t);
    this.events.emit('move', { drone: d.id, fromX, fromY, x: d.x, y: d.y, t });
    const cost = Math.max(1, Math.floor((cfg.moveTicks ?? 400) * Math.pow(1 - (cfg.speedupPerApple ?? 0.03), dino.eaten)));
    return { ok: true, fromX, fromY, dx, dy, cost };
  }

  onHarvest(r, drone, node) {
    const tile = r.tiles[0];
    for (const [item, n] of Object.entries(r.items)) {
      this.inventory.add(item, n, { x: tile.x, y: tile.y, drone: drone.id });
    }
    if (r.ok) this.stats.recordHarvest(r.type, r.tiles.length);
    this.events.emit('harvest', { ...r, x: tile.x, y: tile.y, drone: drone.id, node });
  }

  // Every action uses up a little of the juice the drone drank (Drone.tickRate).
  afterAction(drone) {
    drone.actions++;
    if (drone.juice > 0) drone.juice--;
  }

  // xmel(): one pomegranate juice makes this drone faster for its next actions (settings.json → power).
  drinkJuice(drone) {
    this.inventory.add('Power', -1, 'use');
    drone.juice = (this.settings.power && this.settings.power.actions) || 50;
    this.events.emit('useItem', { item: 'Power', x: drone.x, y: drone.y, drone: drone.id });
  }

  warn(code, params, node, drone) {
    const loc = locOf(node);
    const key = `${code}:${loc ? loc.line : ''}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.events.emit('warning', { code, params, loc, module: node && node._mod, drone: drone ? drone.id : 0 });
  }

  changeHat(drone, hat, t) {
    if (hat === 'Dinosaur_Hat') {
      if (this.dino && this.dino.drone !== drone) return false;
      if (!this.dino) this.startDino(drone, t);
    } else if (this.dino && this.dino.drone === drone) {
      this.finishDino(t);
    }
    drone.hat = hat;
    this.events.emit('hat', { drone: drone.id, hat });
    return true;
  }

  useItem(drone, item, n, t, node) {
    const count = Math.max(1, n || 1);
    const luck = this.calendar.state && this.calendar.state.luck;
    const free = item === 'Water' && !!(luck && luck.freeWater); // Vardavar
    if (!free && this.inventory.get(item) < count) {
      this.warn('notEnoughItem', { item, need: count }, node, drone);
      return false;
    }
    const tile = this.world.tile(drone.x, drone.y);
    if (item === 'Water') {
      const amount = ((this.settings.water && this.settings.water.tankAmount) ?? 0.25) * count;
      this.world.addWater(tile, amount, t);
      if (!free) this.inventory.add('Water', -count, 'use');
      this.events.emit('useItem', { item, x: tile.x, y: tile.y, drone: drone.id });
      this.festivals.splash(tile.x, tile.y);
      return true;
    }
    if (item === 'Fertilizer') {
      let used = 0;
      for (let i = 0; i < count; i++) if (this.world.fertilize(tile, t)) used++;
      if (!used) {
        this.warn('fertilizeNothing', {}, node, drone);
        return false;
      }
      this.inventory.add('Fertilizer', -used, 'use');
      this.events.emit('useItem', { item, x: tile.x, y: tile.y, drone: drone.id });
      return true;
    }
    if (item === 'Weird_Substance') {
      const r = this.useWeirdSubstance(drone, tile, count, t, node);
      if (r) this.inventory.add('Weird_Substance', -count, 'use');
      return r;
    }
    this.warn('cannotUseItem', { item }, node, drone);
    return false;
  }

  // tnkel(Buyser.Labirint): a maze as big as the farm, or as the weird substance allows, around the drone.
  plantMaze(tile, t) {
    if (!this.research.hasEntity('Maze')) return { ok: false, reason: 'entityLocked' };
    const w = this.world;
    const mult = w.mazeMultiplier();
    const side = Math.min(w.width, w.height, Math.floor(this.inventory.get('Weird_Substance') / mult));
    const r = w.createMaze(tile, side * mult, t, true);
    if (r.ok) this.inventory.add('Weird_Substance', -side * mult, 'use');
    return r;
  }

  // Weird substance: makes a maze from a grown bush (after Mazes research) or moves a maze's treasure.
  useWeirdSubstance(drone, tile, count, t, node) {
    const w = this.world;
    if (w.maze && w.maze.contains(tile.x, tile.y)) {
      const gold = w.relocateTreasure(tile, count);
      if (gold > 0) {
        this.inventory.add('Gold', gold, { x: tile.x, y: tile.y, drone: drone.id });
        this.events.emit('treasureMoved', { x: tile.x, y: tile.y, gold });
        return true;
      }
      this.warn('mazeReuse', { need: w.maze.amount }, node, drone);
      return false;
    }
    w.sync(tile, t);
    if (this.research.level((this.settings.maze && this.settings.maze.research) || 'Mazes') > 0 && tile.entity && tile.entity.type === 'Bush') {
      const r = w.createMaze(tile, count, t);
      if (!r.ok) {
        this.warn(r.reason, { need: r.need }, node, drone);
        return false;
      }
      return true;
    }
    this.warn('cannotUseItem', { item: 'Weird_Substance' }, node, drone);
    return false;
  }

  // Why the drone can't fish here: 'pondNeeded' | 'pondNotFull' | 'pondResting' | null.
  fishProblem(tile, t) {
    this.world.sync(tile, t);
    if (tile.ground !== 'Pond') return 'pondNeeded';
    if (!this.world.isFullPond(tile)) return 'pondNotFull';
    return tile.fishAt > t ? 'pondResting' : null;
  }

  // A random fish from a full pond (settings.json → fishing; some bite only in their seasons or
  // weather). Its fish go to the storage; the first golden fish also unlocks the fisher's hat. After a
  // catch the pond rests (settings.json → fishing.restSeconds), so more fish take more ponds.
  // Returns the species.
  catchFish(drone, tile, t = this.time) {
    const cfg = this.settings.fishing || {};
    tile.fishAt = t + (cfg.restSeconds ?? 0);
    const chance = (f) => this.calendar.fishChance(f, cfg.fish && cfg.fish[f]) * (f === 'Golden_Fish' ? this.boost('goldenFish') : 1);
    let r = this.rng.next() * FISH_NAMES.reduce((sum, f) => sum + chance(f), 0);
    const species = FISH_NAMES.find((f) => (r -= chance(f)) < 0) || FISH_NAMES[0];
    const level = this.research.level(cfg.research || 'Fishing');
    const amount = ((cfg.fish && cfg.fish[species] && cfg.fish[species].amount) || 1) * Math.pow(2, Math.max(0, level - 1)) * this.calendar.yieldOf('Fish');
    this.inventory.add('Fish', amount, { x: tile.x, y: tile.y, drone: drone.id });
    this.stats.recordHarvest(species);
    const hat = species === 'Golden_Fish' && cfg.hat && !this.flags.fisherHat ? cfg.hat : null;
    if (hat) this.flags.fisherHat = true;
    this.events.emit('fish', { species, amount, hat, x: tile.x, y: tile.y, drone: drone.id });
    return species;
  }

  // Hats won in events (festivals, the weekly challenge, secret notes, Perfection); they stay in the save.
  earnHat(hat) {
    const hats = (this.flags.hats = this.flags.hats || []);
    if (!hat || hats.includes(hat)) return false;
    hats.push(hat);
    this.events.emit('hatEarned', { hat });
    return true;
  }

  // Eats a dish (village.json → boosts); its boost lasts `seconds` of game time, eating again adds more.
  eat(item, t) {
    const cfg = ((this.config.village || {}).boosts || {})[item];
    if (!cfg) return { ok: false, reason: 'notDish' };
    if (this.inventory.get(item) < 1) return { ok: false, reason: 'none' };
    this.inventory.add(item, -1, 'eat');
    this.addBoost(cfg.kind, item, cfg.multiplier, cfg.seconds, t);
    return { ok: true };
  }

  // A boost of `kind` for `seconds` of game time from t (eating or buying again adds more). item: its picture.
  addBoost(kind, item, multiplier, seconds, t = this.time) {
    if (kind === 'growth') this.world.syncAll(t); // plants grew at the old speed up to now
    const b = this.boosts[kind];
    this.boosts[kind] = { item, multiplier, until: Math.max(b ? b.until : 0, t) + seconds };
    this.events.emit('boost', { kind, item, until: this.boosts[kind].until });
  }

  // Multiplier of an eaten dish's boost: 'speed' | 'growth' | 'goldenFish' (1 without one).
  boost(kind) {
    const b = this.boosts[kind];
    return b ? b.multiplier : 1;
  }

  // At the start of a frame, boosts that ran out end (the farm grows by the old rules up to here).
  updateBoosts() {
    for (const [kind, b] of Object.entries(this.boosts)) {
      if (this.time < b.until) continue;
      if (kind === 'growth') this.world.syncAll(this.time);
      delete this.boosts[kind];
      this.events.emit('boost', { kind, item: b.item, until: 0 });
    }
  }

  measure(drone, tile) {
    const w = this.world;
    if (this.dino && this.dino.drone === drone) return this.dino.apple ? [this.dino.apple.x, this.dino.apple.y] : null;
    if (w.maze && w.maze.contains(tile.x, tile.y)) return [w.maze.treasure.x, w.maze.treasure.y];
    const e = tile.entity;
    if (!e) return null;
    if (e.type === 'Sunflower') return e.data.petals;
    if (e.type === 'Cactus') return e.data.size;
    if (e.type === 'Pumpkin') return w.ripeness(e);
    const fruits = w.entityConfig(e.type).fruits; // an apricot tree: how many fruits it still gives
    return fruits ? (e.data.fruits ?? fruits) : null;
  }

  clearFarm(t) {
    if (this.dino) this.finishDino(t);
    this.world.maze = null;
    for (const tile of this.world.tiles) {
      tile.ground = 'Grassland';
      this.world.freshSoil(tile);
      tile.water = 0;
      tile.lastSync = t;
      this.world.spawnGrass(tile, t);
    }
    this.events.emit('farmCleared', {});
  }

  maxDrones() {
    const m = this.settings.megafarm || {};
    const lvl = this.research.level(m.research || 'Megafarm');
    const list = m.dronesPerLevel || [1, 2, 4, 8, 16, 32];
    return list[Math.min(lvl, list.length - 1)];
  }

  // ------------------------------------------------------------------ scripts

  script(name) {
    return this.scripts.find((s) => s.name === name);
  }

  setScriptCode(name, code) {
    const s = this.script(name);
    if (s) s.code = code;
  }

  // ------------------------------------------------------------------ saving

  // What the leaderboard shows about this player (players/{id}, see storage/account.js).
  leaderStats() {
    const s = this.stats;
    return {
      research: this.research.totalLevels(),
      playSeconds: this.playSeconds,
      hat: this.mainDrone.hat,
      farm: `${this.world.width}×${this.world.height}`,
      points: s.points(),
      code: s.codeWords,
      streak: s.streak,
      day: s.day,
      prevDay: s.prevDay,
      month: s.month,
      prevMonth: s.prevMonth,
      perfect: perfection(this).percent,
      festival: this.festivals.latest(),
      challenge: this.challenge,
      ranch: this.ranch.earned,
      carpets: this.ranch.perfect,
      favorite: this.ranch.favorite,
      ranchPlus: this.ranch.plus,
      ranchChallenge: this.ranch.challenge,
    };
  }

  toSave() {
    return {
      v: SAVE_VERSION,
      seed: this.rng.state,
      time: this.time,
      playSeconds: this.playSeconds,
      inventory: this.inventory.toSave(),
      research: this.research.toSave(),
      world: this.world.toSave(),
      drone: this.mainDrone.toSave(),
      scripts: this.scripts.map((s) => ({ name: s.name, code: s.code })),
      activeScript: this.activeScript,
      stats: this.stats.toSave(),
      production: this.production,
      flags: this.flags,
      village: this.village.toSave(),
      festivals: this.festivals.toSave(),
      notes: this.notes.toSave(),
      stickers: this.stickers.toSave(),
      challenge: this.challenge,
      ranch: this.ranch.toSave(),
      boosts: this.boosts,
      dino: this.dino ? { tail: this.dino.tail, apple: this.dino.apple, eaten: this.dino.eaten, moves: this.dino.moves } : null,
    };
  }
}
