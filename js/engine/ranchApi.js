// The ranch's commands (config/aliases.json → ranch gives their Armenian names). The registry,
// aliases, compile, gate and interpreter host are the farm's (GameApi); a drone works only in its own
// area (I.drone.pen), in the area's coordinates, and fences stop it.
import { GameApi } from './api.js';
import { DIRECTIONS } from './world.js';
import { makeObject, typeKey, formatValue } from '../lang/values.js';
import { GameError } from '../lang/errors.js';

// Farm commands the ranch does not have.
const FARM_ONLY = [
  'plant', 'canHarvest', 'till', 'getGroundType', 'changeHat', 'useItem', 'getWater', 'measure', 'swap', 'getCost', 'unlock', 'numUnlocked',
  'digPond', 'findTreasure', 'festivalDistance', 'catchFish', 'getSeason', 'getWeather', 'getNextWeather', 'make', 'eat', 'buildGreenhouse',
  'getCompanion', 'spawnDrone', 'waitFor', 'hasFinished', 'numDrones', 'maxDrones',
];
export const RANCH_THINGS = ['FeedTrough', 'WaterTrough', 'Well', 'Basket', 'Stall'];
const TROUGHS = ['FeedTrough', 'WaterTrough'];

export class RanchApi extends GameApi {
  aliasConfig() {
    const a = this.game.config.aliases || {};
    const r = a.ranch || {};
    const members = { ...(a.members || {}) };
    for (const [ns, m] of Object.entries(r.members || {})) members[ns] = { ...(members[ns] || {}), ...m };
    const merge = (k) => ({ ...(a[k] || {}), ...(r[k] || {}) });
    return { functions: merge('functions'), constants: merge('constants'), namespaces: merge('namespaces'), members };
  }

  buildEnums(aliases) {
    const cfg = this.game.config.ranch || {};
    this.makeEnum(aliases, 'Items', [...Object.keys(cfg.items || {}), 'Water']);
    this.makeEnum(aliases, 'Animals', Object.keys(cfg.animals || {}));
    this.makeEnum(aliases, 'Machines', RANCH_THINGS);
    this.buildConstants(aliases);
  }

  // What is on the drone's square: an egg (Irer.Dzu), else a thing (Sarqer.Keraman, …), else an animal.
  squareValue(pen, x, y) {
    const item = pen.ground[`${x},${y}`];
    if (item) return this.enums.Items.get(item);
    const o = pen.objectAt(x, y);
    if (o) return this.enums.Machines.get(o.type);
    const a = pen.animalsAt(x, y)[0];
    return a ? this.enums.Animals.get(a.type) : null;
  }

  buildFunctions() {
    super.buildFunctions();
    for (const name of FARM_ONLY) this.globals.delete(name);
    const ranch = this.game;
    const api = this;
    const cfg = () => ranch.cfg;
    // The drone's area, brought up to the drone's time.
    const here = (I) => {
      const pen = I.drone.pen;
      pen.sync(api.now(I));
      return pen;
    };
    const hands = (I) => I.drone.hands;
    const held = (I) => Object.values(hands(I)).reduce((a, b) => a + b, 0);
    const hold = (I, item, n) => (hands(I)[item] = (hands(I)[item] || 0) + n);
    const drop = (I, item, n) => {
      hands(I)[item] -= n;
      if (hands(I)[item] <= 0) delete hands(I)[item];
    };
    const space = (I) => ranch.handsCapacity() - held(I);
    const fail = (I, code, params, node) => {
      api.act(I, false);
      if (code) ranch.warn(code, params || {}, node, I.drone);
      return false;
    };
    const market = (I, node) => {
      if (I.drone.pen.id === ranch.marketId) return true;
      fail(I, 'ranch_notMarket', {}, node);
      return false;
    };
    // An optional amount (the 2nd argument): no amount = as many as possible.
    const count = (v, fn, node) => {
      if (v === undefined || v === null) return Infinity;
      if (typeof v !== 'number' || !(v >= 0)) throw new GameError('badArg', { fn, index: 2, expected: 'amount', got: typeKey(v), gotText: formatValue(v, true) }, node);
      return Math.floor(v);
    };

    // (like the farm's, and the console knows which area printed)
    this.def('print', (I, args) => {
      I.ticks += 1;
      ranch.events.emit('print', { text: args.map((a) => formatValue(a)).join(' '), drone: I.drone.id, pen: I.drone.pen.id, time: api.now(I) });
    });

    this.def('move', (I, args, node) => {
      api.needArgs(args, 1, 'move', node);
      const dir = api.needDirection(args[0], 'move', node);
      const d = I.drone;
      const [dx, dy] = DIRECTIONS[dir];
      if (!d.pen.inside(d.x + dx, d.y + dy)) return fail(I);
      const fromX = d.x;
      const fromY = d.y;
      d.x += dx;
      d.y += dy;
      api.act(I, true);
      const duration = ((this.settings.costs && this.settings.costs.actionSuccess) ?? 200) / d.tickRate();
      const start = api.now(I) - duration;
      d.startAnim('move', fromX, fromY, d.x, d.y, dx, dy, duration);
      d.anim.start = start;
      d.anim.end = start + duration;
      ranch.events.emit('move', { drone: d.id, pen: d.pen.id, x: d.x, y: d.y });
      return true;
    });

    this.def('canMove', (I, args, node) => {
      api.needArgs(args, 1, 'canMove', node);
      const [dx, dy] = DIRECTIONS[api.needDirection(args[0], 'canMove', node)];
      api.getter(I);
      return I.drone.pen.inside(I.drone.x + dx, I.drone.y + dy);
    });

    this.def('getWorldSize', (I) => {
      api.getter(I);
      return I.drone.pen.size;
    });

    this.def('getEntityType', (I) => {
      api.getter(I);
      return api.squareValue(here(I), I.drone.x, I.drone.y);
    });

    this.def('numItems', (I, args, node) => {
      api.needArgs(args, 1, 'numItems', node);
      const item = api.needEnum(args[0], 'Items', 'numItems', 1, node);
      api.getter(I);
      return ranch.inventory.get(item);
    });

    // --- hands: pick up an egg, take feed or water, fill a trough, unload at the basket
    this.def('harvest', (I, args, node) => {
      const pen = here(I);
      const d = I.drone;
      if (!pen.ground[`${d.x},${d.y}`]) return fail(I);
      if (space(I) < 1) return fail(I, 'ranch_handsFull', { n: ranch.handsCapacity() }, node);
      const item = pen.takeGround(d.x, d.y);
      hold(I, item, 1);
      api.act(I, true);
      ranch.events.emit('pickup', { pen: pen.id, x: d.x, y: d.y, item });
      return true;
    });

    this.def('milk', (I, args, node) => {
      const pen = here(I);
      const d = I.drone;
      if (space(I) < 1) return fail(I, 'ranch_handsFull', { n: ranch.handsCapacity() }, node);
      const item = pen.milk(d.x, d.y);
      if (!item) return fail(I);
      hold(I, item, 1);
      api.act(I, true);
      ranch.events.emit('pickup', { pen: pen.id, x: d.x, y: d.y, item });
      return true;
    });

    this.def('take', (I, args, node) => {
      api.needArgs(args, 1, 'take', node);
      const item = api.needEnum(args[0], 'Items', 'take', 1, node);
      const want = count(args[1], 'take', node);
      const pen = here(I);
      const o = pen.objectAt(I.drone.x, I.drone.y);
      const at = o && o.type;
      if (at !== 'Basket' && at !== 'Well') return fail(I, 'ranch_takeWhere', {}, node);
      const feed = ((cfg().items || {})[item] || {}).feed;
      if ((at === 'Well') !== (item === 'Water') || (at === 'Basket' && !feed)) return fail(I, 'ranch_takeWhat', { item }, node);
      const have = at === 'Well' ? Infinity : Math.floor(ranch.inventory.get(item));
      const n = Math.min(want, space(I), have);
      if (space(I) < 1) return fail(I, 'ranch_handsFull', { n: ranch.handsCapacity() }, node);
      if (n <= 0) return fail(I, 'notEnoughItem', { item }, node) || 0;
      if (at === 'Basket') ranch.inventory.add(item, -n, 'take');
      hold(I, item, n);
      api.act(I, true);
      return n;
    });

    this.def('fill', (I, args, node) => {
      const pen = here(I);
      const o = pen.objectAt(I.drone.x, I.drone.y);
      if (!o || !TROUGHS.includes(o.type)) return fail(I, 'ranch_noTrough', {}, node) || 0;
      const item = o.type === 'WaterTrough' ? 'Water' : pen.animalCfg && pen.animalCfg.feed;
      const n = Math.min(hands(I)[item] || 0, ((cfg().troughs || {}).capacity ?? 10) - o.amount);
      if (!hands(I)[item]) return fail(I, 'ranch_wrongFeed', { item: item || 'Grain' }, node) || 0;
      if (n <= 0) return fail(I, 'ranch_troughFull', {}, node) || 0;
      drop(I, item, n);
      o.amount += n;
      api.act(I, true);
      ranch.events.emit('fill', { pen: pen.id, x: o.x, y: o.y, item, n });
      return n;
    });

    this.def('unload', (I, args, node) => {
      const pen = here(I);
      const o = pen.objectAt(I.drone.x, I.drone.y);
      if (!o || o.type !== 'Basket') return fail(I, 'ranch_noBasket', {}, node) || 0;
      let n = 0;
      for (const [item, k] of Object.entries(hands(I))) {
        if (item !== 'Water') ranch.inventory.add(item, k, 'ranch');
        n += k;
      }
      I.drone.hands = {};
      api.act(I, true);
      if (n) ranch.unloaded(pen, I.drone);
      return n;
    });

    this.def('inHands', (I, args, node) => {
      api.getter(I);
      if (args[0] === undefined) return held(I);
      return hands(I)[api.needEnum(args[0], 'Items', 'inHands', 1, node)] || 0;
    });

    this.def('build', (I, args, node) => {
      api.needArgs(args, 1, 'build', node);
      const type = api.needEnum(args[0], 'Machines', 'build', 1, node);
      const pen = here(I);
      const d = I.drone;
      if (!TROUGHS.includes(type)) return fail(I, 'ranch_cantBuild', { machine: type }, node);
      if (!ranch.tokens[type]) return fail(I, 'ranch_noToken', { machine: type }, node);
      if (pen.objectAt(d.x, d.y) || pen.ground[`${d.x},${d.y}`]) return fail(I, 'ranch_occupied', {}, node);
      ranch.tokens[type]--;
      pen.objects.push({ type, x: d.x, y: d.y, amount: 0 });
      api.act(I, true);
      ranch.events.emit('build', { pen: pen.id, x: d.x, y: d.y, type });
      return true;
    });

    // --- care
    this.def('pet', (I) => {
      const pen = here(I);
      const n = pen.pet(I.drone.x, I.drone.y, api.now(I) + ((cfg().needs || {}).petSeconds ?? 60));
      api.act(I, n > 0);
      if (n) ranch.events.emit('pet', { pen: pen.id, x: I.drone.x, y: I.drone.y });
      return n > 0;
    });

    this.def('clear', (I) => {
      here(I).clean(I.drone.x, I.drone.y);
      api.act(I, true);
      ranch.events.emit('clean', { pen: I.drone.pen.id, x: I.drone.x, y: I.drone.y });
    });

    this.def('dirt', (I) => {
      api.getter(I);
      return Math.round(here(I).dirtAt(I.drone.x, I.drone.y));
    });

    // The animals of the drone's area as objects (a copy: changing it changes nothing).
    this.def('animals', (I) => {
      api.getter(I);
      return here(I).animals.map((a) => {
        const o = makeObject();
        Object.assign(o, {
          id: a.id,
          tesak: api.enums.Animals.get(a.type),
          x: a.x,
          y: a.y,
          sov: Math.round(a.hunger),
          carav: Math.round(a.thirst),
          tramadrutyun: Math.round(a.mood),
          patrast: a.prod >= 1 && !cfg().animals[a.type].lays,
        });
        return o;
      });
    });

    // --- the market's drone: prices, selling, buying feed, the farm's cart, the villagers' orders
    this.def('price', (I, args, node) => {
      api.needArgs(args, 1, 'price', node);
      const item = api.needEnum(args[0], 'Items', 'price', 1, node);
      api.getter(I);
      return ranch.price(item);
    });

    this.def('sell', (I, args, node) => {
      api.needArgs(args, 1, 'sell', node);
      const item = api.needEnum(args[0], 'Items', 'sell', 1, node);
      const n = count(args[1], 'sell', node);
      if (!market(I, node)) return 0;
      const r = ranch.sell(item, n);
      if (!r.ok) return fail(I, 'ranch_cantSell', { item }, node) || 0;
      api.act(I, r.dram > 0);
      return r.dram;
    });

    this.def('buy', (I, args, node) => {
      api.needArgs(args, 1, 'buy', node);
      const item = api.needEnum(args[0], 'Items', 'buy', 1, node);
      const n = count(args[1] ?? 1, 'buy', node);
      if (!market(I, node)) return 0;
      const r = ranch.buyFeed(item, n);
      if (!r.ok) return fail(I, 'ranch_cantBuy', { item }, node) || 0;
      if (r.n < n) ranch.warn('ranch_noMoney', { n: n * ranch.price(item) }, node, I.drone);
      api.act(I, r.n > 0);
      return r.n;
    });

    this.def('bring', (I, args, node) => {
      api.needArgs(args, 1, 'bring', node);
      const item = api.needEnum(args[0], 'Items', 'bring', 1, node);
      const n = count(args[1] ?? 1, 'bring', node);
      if (!market(I, node)) return 0;
      const r = ranch.bring(item, n);
      if (!r.ok) return fail(I, 'ranch_cantBring', { item }, node) || 0;
      if (r.n < n) ranch.warn('ranch_cartShort', { item, cost: r.need }, node, I.drone);
      api.act(I, r.n > 0);
      return r.n;
    });

    this.def('orders', (I) => {
      api.getter(I);
      return ranch.orders().list.map((q) => {
        const o = makeObject();
        Object.assign(o, { anun: ranch.villager(q.who).name, irer: api.itemObject(q.items), gin: q.pay, katarvac: q.done });
        return o;
      });
    });

    this.def('deliver', (I, args, node) => {
      api.needArgs(args, 1, 'deliver', node);
      const i = Math.floor(Number(args[0]));
      if (!market(I, node)) return false;
      const r = ranch.deliver(i);
      if (!r.ok) return fail(I, `ranch_order_${r.reason}`, { n: args[0], cost: r.missing }, node);
      api.act(I, true);
      return true;
    });
  }
}
