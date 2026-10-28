// The game API that player code can call (harvest, move, plant, …), the enums
// (Entities, Items, …), Armenian aliases, and the "host" the interpreter talks to.
import { BuiltinFunction, EnumValue, Namespace, DroneHandle, makeObject, formatValue, typeKey, isCallable } from '../lang/values.js';
import { GameError } from '../lang/errors.js';
import { createLibraries } from '../lang/stdlib.js';
import { parseProgram } from '../lang/frontend-js.js';
import { checkProgram } from '../lang/gate.js';
import { suggestNames } from '../core/util.js';
import { DIRECTIONS } from './world.js';

export const ENTITY_NAMES = ['Grass', 'Bush', 'Tree', 'Carrot', 'Pumpkin', 'Dead_Pumpkin', 'Sunflower', 'Cactus', 'Hedge', 'Treasure', 'Apple', 'Dinosaur'];
export const ITEM_NAMES = ['Hay', 'Wood', 'Carrot', 'Pumpkin', 'Power', 'Water', 'Fertilizer', 'Weird_Substance', 'Cactus', 'Bone', 'Gold', 'Fish'];
export const GROUND_NAMES = ['Grassland', 'Soil', 'Pond'];
export const FISH_NAMES = ['Carp', 'Barbel', 'Trout', 'Golden_Fish'];

// Python habits → JavaScript (shown in "not defined" errors).
const PYTHON_HINTS = {
  True: 'true',
  False: 'false',
  None: 'null',
  len: '.length',
  range: 'for (let i = 0; i < n; i++)',
  def: 'function',
  elif: 'else if',
  and: '&&',
  or: '||',
  not: '!',
  print_: 'print',
};

export class GameApi {
  constructor(game) {
    this.game = game;
    this.globals = new Map(); // canonical -> { kind: function|lib|enum|constant|class, value }
    this.aliases = new Map(); // alias -> canonical
    this.labels = new Map(); // canonical -> name shown to players (first alias)
    this.enums = {};
    this.compiled = new Map(); // script name -> { code, ast, errors }
    const aliases = game.config.aliases || {};
    this.buildEnums(aliases);
    this.buildFunctions();
    this.buildLibraries();
    this.applyAliases(aliases);
  }

  get settings() {
    return this.game.config.settings;
  }

  // ------------------------------------------------------------------ registry

  // Enum values carry their shown (Armenian) label, so they are built after reading the aliases.
  buildEnums(aliases) {
    const first = (list) => (Array.isArray(list) && list[0]) || null;
    const mk = (name, members) => {
      const ns = new Namespace(name, 'enum', first(aliases.namespaces && aliases.namespaces[name]) || name);
      const own = (aliases.members && aliases.members[name]) || {};
      for (const m of members) {
        const label = first(own[m]);
        if (label) ns.labels.set(m, label);
        ns.set(m, new EnumValue(name, m, `${ns.label}.${label || m}`));
      }
      this.enums[name] = ns;
      this.globals.set(name, { kind: 'enum', value: ns });
      return ns;
    };
    mk('Entities', ENTITY_NAMES);
    mk('Items', ITEM_NAMES);
    mk('Grounds', GROUND_NAMES);
    mk('Fishes', FISH_NAMES);
    mk('Hats', Object.keys(this.settings.hats || { Straw_Hat: {} }));
    mk('Unlocks', this.game.config.research.nodes.map((n) => n.id));
    this.directions = {};
    for (const d of Object.keys(DIRECTIONS)) {
      const v = new EnumValue('', d, first(aliases.constants && aliases.constants[d]) || d);
      this.directions[d] = v;
      this.globals.set(d, { kind: 'constant', value: v });
    }
    this.globals.set('undefined', { kind: 'constant', value: undefined });
    this.globals.set('NaN', { kind: 'constant', value: NaN });
    this.globals.set('Infinity', { kind: 'constant', value: Infinity });
    this.globals.set('Map', { kind: 'class', value: { name: 'Map' } });
    this.globals.set('Set', { kind: 'class', value: { name: 'Set' } });
  }

  def(name, impl, opts = {}) {
    this.globals.set(name, { kind: 'function', value: new BuiltinFunction({ name, impl, gen: !!opts.gen }) });
  }

  buildLibraries() {
    const libs = createLibraries();
    for (const [name, value] of Object.entries(libs)) {
      if (name === 'newObject') continue;
      const kind = value instanceof Namespace ? 'lib' : 'function';
      this.globals.set(name, { kind, value });
    }
  }

  // aliases.json: { canonical: [shownName, ...otherNames] }. The canonical (English) name keeps working.
  applyAliases(aliases) {
    for (const section of ['functions', 'constants', 'namespaces']) {
      for (const [canonical, names] of Object.entries(aliases[section] || {})) {
        const g = this.globals.get(canonical);
        if (!g || !Array.isArray(names) || !names.length) continue;
        for (const alias of names) if (!this.globals.has(alias)) this.aliases.set(alias, canonical);
        this.labels.set(canonical, names[0]);
        if (g.value instanceof BuiltinFunction) g.value.label = names[0];
      }
    }
    for (const [nsName, members] of Object.entries(aliases.members || {})) {
      const ns = this.enums[nsName];
      if (!ns) continue;
      for (const [canonical, names] of Object.entries(members)) for (const alias of names || []) ns.alias(alias, canonical);
    }
  }

  canonicalName(name) {
    return this.aliases.get(name) || name;
  }

  // The name players see for a canonical global: displayName('plant') -> 'tnkel'.
  displayName(canonical) {
    return this.labels.get(canonical) || canonical;
  }

  // How the editor and Bridgy colour a word: 'fn' (game/JS function), 'enum' or null.
  codeKind(word) {
    const canon = this.canonicalName(word);
    const g = this.globals.get(canon);
    if (!g) return null;
    if (g.kind === 'function' || g.kind === 'lib') return 'fn';
    if (g.kind === 'enum' || (g.kind === 'constant' && canon !== 'undefined')) return 'enum';
    return null;
  }

  // 'unlocked' | 'locked' | 'unknown'
  globalStatus(name) {
    const canon = this.canonicalName(name);
    const g = this.globals.get(canon);
    if (!g) return 'unknown';
    if ((g.kind === 'function' || g.kind === 'lib') && !this.game.research.hasFunction(canon)) return 'locked';
    return 'unlocked';
  }

  // Shown names (one per global, hidden aliases left out) for editor autocomplete.
  knownNames({ includeLocked = false } = {}) {
    const out = [];
    for (const [name, g] of this.globals) {
      if (name === 'undefined' || name === 'NaN' || name === 'Infinity') continue;
      if (!includeLocked && (g.kind === 'function' || g.kind === 'lib') && !this.game.research.hasFunction(name)) continue;
      out.push(this.displayName(name));
    }
    return out;
  }

  // "Did you mean": matches every accepted spelling (so English typos work too) but answers
  // with the shown names only.
  suggest(name, candidates) {
    if (candidates) return suggestNames(name, candidates);
    const all = [...this.globals.keys(), ...this.aliases.keys()].filter((n) => n !== 'undefined' && n !== 'NaN' && n !== 'Infinity');
    return [...new Set(suggestNames(name, all, 4).map((n) => this.displayName(this.canonicalName(n))))].slice(0, 2);
  }

  notDefinedError(name, node) {
    const err = new GameError('notDefined', { name, suggestions: this.suggest(name) }, node);
    this.decorateNotDefined(err);
    return err;
  }

  // ------------------------------------------------------------------ compile

  // Parses and checks a script. Throws the first error (with .module set).
  compile(name, code) {
    const cached = this.compiled.get(name);
    if (cached && cached.code === code && cached.researchStamp === this.researchStamp()) {
      if (cached.errors.length) throw cached.errors[0];
      return cached;
    }
    const result = { code, ast: null, errors: [], researchStamp: this.researchStamp() };
    try {
      result.ast = parseProgram(code, name);
      result.errors = checkProgram(result.ast, this.gateContext());
    } catch (e) {
      if (e instanceof GameError) result.errors = [e];
      else throw e;
    }
    for (const e of result.errors) e.module = name;
    for (const e of result.errors) if (e.code === 'notDefined') this.decorateNotDefined(e);
    this.compiled.set(name, result);
    if (result.errors.length) throw result.errors[0];
    return result;
  }

  // For live editor checking: returns all errors without throwing.
  check(name, code) {
    try {
      this.compile(name, code);
      return [];
    } catch (e) {
      if (e instanceof GameError) return this.compiled.get(name)?.errors || [e];
      return [];
    }
  }

  decorateNotDefined(err) {
    const name = err.params.name;
    if (PYTHON_HINTS[name]) err.params.python = PYTHON_HINTS[name];
    const enumHits = [];
    for (const ns of Object.values(this.enums)) if (ns.has(name)) enumHits.push(String(ns.get(name)));
    if (enumHits.length) err.params.enumHint = enumHits;
  }

  researchStamp() {
    return this.game.research.totalLevels();
  }

  gateContext() {
    const research = this.game.research;
    return {
      isSyntaxUnlocked: (f) => research.hasSyntax(f),
      globalStatus: (n) => this.globalStatus(n),
      canonical: (n) => this.canonicalName(n),
      suggest: (n) => this.suggest(n),
    };
  }

  // ------------------------------------------------------------------ host for the interpreter

  createHost() {
    const api = this;
    const game = this.game;
    return {
      getGlobal(name, node) {
        const canon = api.canonicalName(name);
        const g = api.globals.get(canon);
        if (!g) throw api.notDefinedError(name, node);
        if ((g.kind === 'function' || g.kind === 'lib') && !game.research.hasFunction(canon)) {
          throw new GameError('lockedFunction', { name, canonical: canon }, node);
        }
        return g.value;
      },
      hasGlobal(name) {
        return api.globals.has(api.canonicalName(name));
      },
      loadModule(spec, fromName, node) {
        const name = api.resolveModuleName(spec);
        const script = game.scripts.find((s) => s.name === name);
        if (!script) throw new GameError('importNotFound', { name: spec }, node);
        const compiled = api.compile(script.name, script.code);
        return { name: script.name, ast: compiled.ast };
      },
      random: () => game.rng.next(),
      suggest: (name, names) => suggestNames(name, names),
      warn: (code, params, node, interp) => game.warn(code, params, node, interp.drone),
    };
  }

  resolveModuleName(spec) {
    let s = String(spec).trim();
    if (s.startsWith('./')) s = s.slice(2);
    if (s.endsWith('.js')) s = s.slice(0, -3);
    const exact = this.game.scripts.find((x) => x.name === s);
    if (exact) return exact.name;
    const ci = this.game.scripts.find((x) => x.name.toLowerCase() === s.toLowerCase());
    return ci ? ci.name : s;
  }

  // ------------------------------------------------------------------ helpers for builtins

  now(I) {
    const d = I.drone;
    return d.time + I.ticks / d.tickRate();
  }

  act(I, ok) {
    const c = this.settings.costs || {};
    if (ok) {
      I.action(c.actionSuccess ?? 200, true);
      this.game.afterAction(I.drone);
    } else I.action(c.actionFail ?? 1, false);
  }

  getter(I) {
    I.ticks += (this.settings.costs && this.settings.costs.getter) ?? 1;
  }

  needEnum(v, group, fn, index, node) {
    if (v instanceof EnumValue && v.group === group) return v.name;
    throw new GameError('badArg', { fn, index, expected: group, got: typeKey(v), gotText: formatValue(v, true) }, node);
  }

  needDirection(v, fn, node) {
    if (v instanceof EnumValue && v.group === '' && DIRECTIONS[v.name]) return v.name;
    throw new GameError('badArg', { fn, index: 1, expected: 'Direction', got: typeKey(v), gotText: formatValue(v, true) }, node);
  }

  needArgs(args, n, fn, node) {
    if (args.length < n) throw new GameError('missingArg', { fn, count: n }, node);
  }

  droneTile(I) {
    return this.game.world.tile(I.drone.x, I.drone.y);
  }

  dirTile(I, dirName) {
    const [dx, dy] = DIRECTIONS[dirName];
    return this.game.world.tile(I.drone.x + dx, I.drone.y + dy);
  }

  entityValue(type) {
    return type ? this.enums.Entities.get(type) || null : null;
  }

  // { Hay: 20 } -> player object with shown item names: { ChorXot: 20 }
  itemObject(items) {
    const o = makeObject();
    for (const [k, n] of Object.entries(items)) o[this.enums.Items.labelOf(k)] = n;
    return o;
  }

  // ------------------------------------------------------------------ the game functions

  buildFunctions() {
    const game = this.game;
    const api = this;
    const world = () => game.world;

    // --- always available
    this.def('harvest', (I, args, node) => {
      const tile = api.droneTile(I);
      const t = api.now(I);
      const r = world().harvest(tile, t);
      if (!r.removed) {
        api.act(I, false);
        return false;
      }
      api.act(I, true);
      game.onHarvest(r, I.drone, node);
      return r.ok;
    });

    this.def('doAFlip', (I) => {
      const d = I.drone;
      const seconds = (this.settings.time && this.settings.time.doAFlipSeconds) ?? 1;
      const ticks = Math.max(1, Math.round(seconds * d.tickRate()));
      d.startAnim('flip', d.x, d.y, d.x, d.y, 0, 0, seconds);
      d.anim.start = api.now(I);
      d.anim.end = d.anim.start + seconds;
      I.action(ticks, true);
      game.events.emit('flip', { drone: d.id });
    });

    // --- research: Expand
    this.def('move', (I, args, node) => {
      api.needArgs(args, 1, 'move', node);
      const dir = api.needDirection(args[0], 'move', node);
      const d = I.drone;
      const r = game.moveDrone(d, dir, api.now(I), node);
      if (!r.ok) {
        api.act(I, false);
        return false;
      }
      if (r.cost) {
        I.action(r.cost, true);
        game.afterAction(d);
      } else api.act(I, true);
      const duration = (r.cost || ((this.settings.costs && this.settings.costs.actionSuccess) ?? 200)) / d.tickRate();
      const start = api.now(I) - duration;
      d.startAnim('move', r.fromX, r.fromY, d.x, d.y, r.dx, r.dy, duration);
      d.anim.start = start;
      d.anim.end = start + duration;
      return true;
    });

    this.def('canMove', (I, args, node) => {
      api.needArgs(args, 1, 'canMove', node);
      const dir = api.needDirection(args[0], 'canMove', node);
      api.getter(I);
      return game.canMove(I.drone, dir);
    });

    this.def('getWorldSize', (I) => {
      api.getter(I);
      return world().size;
    });

    // --- research: plant()
    this.def('plant', (I, args, node) => {
      api.needArgs(args, 1, 'plant', node);
      const type = api.needEnum(args[0], 'Entities', 'plant', 1, node);
      const tile = api.droneTile(I);
      const r = world().plant(tile, type, api.now(I));
      if (!r.ok) {
        api.act(I, false);
        game.warn(`plant_${r.reason}`, { entity: type, cost: r.cost }, node, I.drone);
        return false;
      }
      api.act(I, true);
      game.events.emit('plant', { type, x: tile.x, y: tile.y, drone: I.drone.id });
      return true;
    });

    this.def('canHarvest', (I) => {
      api.getter(I);
      const tile = api.droneTile(I);
      world().sync(tile, api.now(I));
      return world().isRipe(tile);
    });

    this.def('getEntityType', (I) => {
      api.getter(I);
      const tile = api.droneTile(I);
      world().sync(tile, api.now(I));
      return tile.entity ? api.entityValue(tile.entity.type) : null;
    });

    // --- research: Carrots
    this.def('till', (I) => {
      const tile = api.droneTile(I);
      world().till(tile, api.now(I));
      api.act(I, true);
      game.events.emit('till', { x: tile.x, y: tile.y, ground: tile.ground, drone: I.drone.id });
    });

    this.def('getGroundType', (I) => {
      api.getter(I);
      return this.enums.Grounds.get(api.droneTile(I).ground);
    });

    // --- research: Senses (x, y)
    this.def('getPosX', (I) => {
      api.getter(I);
      return I.drone.x;
    });
    this.def('getPosY', (I) => {
      api.getter(I);
      return I.drone.y;
    });
    this.def('numItems', (I, args, node) => {
      api.needArgs(args, 1, 'numItems', node);
      const item = api.needEnum(args[0], 'Items', 'numItems', 1, node);
      api.getter(I);
      return game.inventory.get(item);
    });

    // --- research: print()
    this.def('print', (I, args) => {
      I.ticks += 1;
      const text = args.map((a) => formatValue(a)).join(' ');
      game.events.emit('print', { text, drone: I.drone.id, time: api.now(I) });
    });

    // --- research: Hats
    this.def('changeHat', (I, args, node) => {
      api.needArgs(args, 1, 'changeHat', node);
      const hat = api.needEnum(args[0], 'Hats', 'changeHat', 1, node);
      if (!game.research.hasHat(hat)) {
        api.act(I, false);
        game.warn('hatLocked', { hat }, node, I.drone);
        return false;
      }
      const r = game.changeHat(I.drone, hat, api.now(I));
      api.act(I, r !== false);
      return r !== false;
    });

    // --- research: Watering / Fertilizer
    this.def('useItem', (I, args, node) => {
      api.needArgs(args, 1, 'useItem', node);
      const item = api.needEnum(args[0], 'Items', 'useItem', 1, node);
      const n = args.length > 1 ? Math.floor(Number(args[1])) : 1;
      const r = game.useItem(I.drone, item, n, api.now(I), node);
      if (r && item === 'Weird_Substance') I.drone.anim = null;
      api.act(I, !!r);
      return !!r;
    });

    this.def('getWater', (I) => {
      api.getter(I);
      const tile = api.droneTile(I);
      world().sync(tile, api.now(I));
      return Math.round(tile.water * 1000) / 1000;
    });

    // --- research: Sunflowers / Cactus (measure), Cactus (swap)
    this.def('measure', (I, args, node) => {
      api.getter(I);
      let tile = api.droneTile(I);
      if (args.length && args[0] !== undefined && args[0] !== null) tile = api.dirTile(I, api.needDirection(args[0], 'measure', node));
      world().sync(tile, api.now(I));
      return game.measure(I.drone, tile);
    });

    this.def('swap', (I, args, node) => {
      api.needArgs(args, 1, 'swap', node);
      const dir = api.needDirection(args[0], 'swap', node);
      const ok = world().swap(api.droneTile(I), api.dirTile(I, dir), api.now(I));
      api.act(I, ok);
      if (ok) game.events.emit('swap', { drone: I.drone.id, dir });
      return ok;
    });

    // --- research: getTime()
    this.def('getTime', (I) => api.now(I));
    this.def('getTickCount', (I) => I.drone.tickCount + I.ticks);

    // --- research: setSpeed()
    this.def('setSpeed', (I, args, node) => {
      api.needArgs(args, 1, 'setSpeed', node);
      const s = Number(args[0]);
      I.drone.execSpeed = Number.isFinite(s) && s > 0 ? s : 0;
      api.getter(I);
    });

    // --- research: getCost() / unlock()
    this.def('getCost', (I, args, node) => {
      api.needArgs(args, 1, 'getCost', node);
      api.getter(I);
      const v = args[0];
      if (v instanceof EnumValue && v.group === 'Unlocks') {
        const lvl = args.length > 1 ? Math.floor(Number(args[1])) : game.research.level(v.name);
        const cost = game.research.costAt(v.name, lvl);
        return cost ? api.itemObject(cost) : null;
      }
      if (v instanceof EnumValue && v.group === 'Entities') return api.itemObject(world().plantCost(v.name));
      throw new GameError('badArg', { fn: 'getCost', index: 1, expected: 'Unlocks', got: typeKey(v), gotText: formatValue(v, true) }, node);
    });

    this.def('unlock', (I, args, node) => {
      api.needArgs(args, 1, 'unlock', node);
      const id = api.needEnum(args[0], 'Unlocks', 'unlock', 1, node);
      const r = game.research.buy(id);
      api.act(I, r.ok);
      return r.ok;
    });

    this.def('numUnlocked', (I, args, node) => {
      api.needArgs(args, 1, 'numUnlocked', node);
      const id = api.needEnum(args[0], 'Unlocks', 'numUnlocked', 1, node);
      api.getter(I);
      return game.research.level(id);
    });

    // --- research: random()
    this.def('random', (I) => {
      api.getter(I);
      return game.rng.next();
    });

    // --- research: Fishing (dig a pond, fill it with water, fish)
    this.def('digPond', (I) => {
      const tile = api.droneTile(I);
      const ok = world().digPond(tile, api.now(I));
      api.act(I, ok);
      if (ok) game.events.emit('dig', { x: tile.x, y: tile.y, drone: I.drone.id });
      return ok;
    });

    this.def(
      'catchFish',
      function* catchFish(I, args, node) {
        const tile = api.droneTile(I);
        const problem = game.fishProblem(tile, api.now(I));
        if (problem) {
          game.warn(problem, { water: Math.round(tile.water * 100) }, node, I.drone);
          api.act(I, false);
          return null;
        }
        // castSeconds at the base speed, so speed upgrades make casting faster like every action
        const d = I.drone;
        const seconds = (api.settings.fishing && api.settings.fishing.castSeconds) ?? 3;
        const ticks = Math.max(1, Math.round(seconds * ((api.settings.time && api.settings.time.ticksPerSecond) ?? 400)));
        d.startAnim('fish', d.x, d.y, d.x, d.y, 0, 0, ticks / d.tickRate());
        d.anim.start = api.now(I);
        d.anim.end = d.anim.start + ticks / d.tickRate();
        I.ticks += ticks; // the line is in the water…
        yield 2; // Y.ACTION
        game.afterAction(d);
        if (game.fishProblem(tile, api.now(I))) return null; // the pond was filled in meanwhile
        return api.enums.Fishes.get(game.catchFish(d, tile));
      },
      { gen: true },
    );

    // --- farm reset helper
    this.def('clear', (I) => {
      game.clearFarm(api.now(I));
      I.drone.x = 0;
      I.drone.y = 0;
      I.drone.anim = null;
      api.act(I, true);
    });

    // --- research: Polyculture (phase 3)
    this.def('getCompanion', (I) => {
      api.getter(I);
      return game.getCompanion(api.droneTile(I), api.now(I));
    });

    // --- research: Megafarm (phase 3)
    this.def('spawnDrone', (I, args, node) => {
      api.needArgs(args, 1, 'spawnDrone', node);
      const fn = args[0];
      if (!isCallable(fn)) throw new GameError('badArg', { fn: 'spawnDrone', index: 1, expected: 'function', got: typeKey(fn), gotText: formatValue(fn, true) }, node);
      const d = game.runner.spawnDrone(I.drone, fn, args.slice(1), api.now(I));
      api.act(I, !!d);
      return d ? new DroneHandle(d) : null;
    });

    this.def(
      'waitFor',
      function* waitFor(I, args, node) {
        api.needArgs(args, 1, 'waitFor', node);
        const h = args[0];
        if (!(h instanceof DroneHandle)) {
          throw new GameError('badArg', { fn: 'waitFor', index: 1, expected: 'drone', got: typeKey(h), gotText: formatValue(h, true) }, node);
        }
        I.ticks += 1;
        while (h.drone.state === 'running' || h.drone.state === 'waiting') {
          I.drone.waitingFor = h.drone;
          yield 4; // Y.WAIT
        }
        I.drone.waitingFor = null;
        return h.drone.result;
      },
      { gen: true },
    );

    this.def('hasFinished', (I, args, node) => {
      api.needArgs(args, 1, 'hasFinished', node);
      const h = args[0];
      if (!(h instanceof DroneHandle)) {
        throw new GameError('badArg', { fn: 'hasFinished', index: 1, expected: 'drone', got: typeKey(h), gotText: formatValue(h, true) }, node);
      }
      api.getter(I);
      return h.drone.state === 'done' || h.drone.state === 'error';
    });

    this.def('numDrones', (I) => {
      api.getter(I);
      return game.runner.activeDroneCount();
    });

    this.def('maxDrones', (I) => {
      api.getter(I);
      return game.maxDrones();
    });
  }
}
